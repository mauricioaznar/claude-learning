// The signing secret. `process.env.X` is typed `string | undefined`, so guard it
// once here — a missing secret should fail loudly at boot, not silently sign
// tokens with the string "undefined".
import {requireEnv} from "./require-env";

export const ACCESS_TOKEN_SECRET = requireEnv("ACCESS_TOKEN_SECRET");


export const DB_HOST = requireEnv("DB_HOST");
export const DB_PORT = Number(requireEnv("DB_PORT"));
export const DB_USER = requireEnv("DB_USER");
export const DB_PASSWORD =  requireEnv("DB_PASSWORD");
export const DB_NAME = requireEnv("DB_NAME");
