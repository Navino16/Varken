/**
 * QuestDB output configuration types
 */

export interface QuestDBConfig {
  url: string;
  port: number;
  ssl: boolean;
  verifySsl: boolean;
}
