// Hand-written helpers for the generated API types in this folder (the other files are generated).

type JsonBody<Operation> = Operation extends {
  responses: { 200: { content: { 'application/json': infer Body } } };
}
  ? Body
  : never;

/** `application/json` body of the 200 response of `Paths[P][M]`, `never` when the spec declares none. */
export type JsonResponse<Paths, P extends keyof Paths, M extends string = 'get'> = Paths[P] extends Record<
  M,
  infer Operation
>
  ? JsonBody<Operation>
  : never;
