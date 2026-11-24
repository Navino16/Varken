/**
 * Compile-time contract for API calls, derived from the `paths` types generated from each service's spec
 * (src/types/generated). Unknown endpoints, unknown or mistyped parameters and undeclared response fields
 * fail `tsc`.
 */

type JsonBody<Operation> = Operation extends {
  responses: { 200: { content: { 'application/json': infer Body } } };
}
  ? Body
  : never;

type GetOperation<Paths, P extends keyof Paths> = Paths[P] extends { get: infer Operation } ? Operation : never;

type Parameters<Operation> = Operation extends { parameters: infer P } ? P : never;

/** Builds `{ key: T }`, `{ key?: T }` or `{ key?: never }` from a generated `parameters` entry. */
type ParameterOption<Operation, Key extends 'query' | 'path'> =
  Parameters<Operation> extends Record<Key, infer Required>
    ? [Required] extends [never]
      ? { [K in Key]?: never }
      : { [K in Key]: Required }
    : Parameters<Operation> extends Partial<Record<Key, infer Optional>>
      ? [Exclude<Optional, undefined>] extends [never]
        ? { [K in Key]?: never }
        : { [K in Key]?: Exclude<Optional, undefined> }
      : { [K in Key]?: never };

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

export type ApiOptions<Operation> = ParameterOption<Operation, 'query'> & ParameterOption<Operation, 'path'>;

type ApiArgs<Operation> = [RequiredKeys<ApiOptions<Operation>>] extends [never]
  ? [options?: ApiOptions<Operation>]
  : [options: ApiOptions<Operation>];

/** Spec paths that declare a GET operation. */
export type GetPath<Paths> = {
  [P in keyof Paths]: Paths[P] extends { get: infer Operation } ? ([Operation] extends [never] ? never : P) : never;
}[keyof Paths] &
  string;

/** `application/json` body of the 200 response of `Paths[P][M]`, `never` when the spec declares none. */
export type JsonResponse<Paths, P extends keyof Paths, M extends string = 'get'> = Paths[P] extends Record<
  M,
  infer Operation
>
  ? JsonBody<Operation>
  : never;

/** GET paths whose response is a `{ records, totalRecords }` page (Servarr paging). */
export type PagedPath<Paths> = {
  [P in GetPath<Paths>]: 'records' extends keyof JsonResponse<Paths, P> ? P : never;
}[GetPath<Paths>];

type PageRecord<Page> = Page extends { records?: (infer R)[] | null } ? R : never;

export interface ApiClient<Paths> {
  get<P extends GetPath<Paths>>(path: P, ...args: ApiArgs<GetOperation<Paths, P>>): Promise<JsonResponse<Paths, P>>;
  getAllPages<P extends PagedPath<Paths>>(
    path: P,
    ...args: ApiArgs<GetOperation<Paths, P>>
  ): Promise<PageRecord<JsonResponse<Paths, P>>[]>;
}

export interface ApiCallOptions {
  query?: Record<string, unknown>;
  path?: Record<string, unknown>;
}
