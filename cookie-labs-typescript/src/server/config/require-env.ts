export function requireEnv(envVariableKey: string): string {
    const env = process.env[envVariableKey];
    if (!env) {
        throw new Error(`${envVariableKey} not found`);
    }
    return env as string;
}