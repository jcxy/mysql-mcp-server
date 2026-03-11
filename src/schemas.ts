import { z } from 'zod';

// MySQL Query tool input schema
export const MySQLQuerySchema = z.object({
  sql: z.string()
    .min(1, "SQL statement cannot be empty")
    .describe("The SQL SELECT query to execute"),
}).strict();

export type MySQLQueryInput = z.infer<typeof MySQLQuerySchema>;

// MySQL Execute tool input schema
export const MySQLExecuteSchema = z.object({
  sql: z.string()
    .min(1, "SQL statement cannot be empty")
    .describe("The SQL statement to execute (INSERT, UPDATE, DELETE)"),
}).strict();

export type MySQLExecuteInput = z.infer<typeof MySQLExecuteSchema>;