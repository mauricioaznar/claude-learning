// Client mirror of the backend password policy
// (`nestjs-inopack-graphql` `src/common/constants/password-policy.ts`). The
// backend is the real gate; this exists so the user form can validate and the
// live requirements popup can tick rules off before any round trip. Keep the two
// rule lists identical — the backend one is the authority.
//
// Rules (agreed 2026-09-10): at least 10 characters, and at least one letter, one
// number and one symbol. The letter rule is what stops an all-digits/all-symbol
// password. "Symbol" is anything that is not a letter or a digit.
//
// es5 build note: plain regex + Array methods only — no Map/Set iterator spreads
// (see docs/memory/project_react_build_traps.md).
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRuleResult {
    id: string;
    label: string;
    met: boolean;
}

const rules: {
    id: string;
    label: string;
    test: (password: string) => boolean;
}[] = [
    {
        id: 'length',
        label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
        test: (password) => password.length >= PASSWORD_MIN_LENGTH,
    },
    {
        id: 'letter',
        label: 'Al menos una letra',
        test: (password) => /[a-zA-Z]/.test(password),
    },
    {
        id: 'number',
        label: 'Al menos un número',
        test: (password) => /[0-9]/.test(password),
    },
    {
        id: 'symbol',
        label: 'Al menos un símbolo',
        test: (password) => /[^a-zA-Z0-9]/.test(password),
    },
];

// One entry per rule with its live pass/fail — drives the requirements popup.
export function evaluatePassword(password: string): PasswordRuleResult[] {
    return rules.map((rule) => ({
        id: rule.id,
        label: rule.label,
        met: rule.test(password),
    }));
}

export function isPasswordValid(password: string): boolean {
    return rules.every((rule) => rule.test(password));
}
