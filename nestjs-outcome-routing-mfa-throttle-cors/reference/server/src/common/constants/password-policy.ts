import { BadRequestException } from '@nestjs/common';

// Single source of truth for the password strength policy, shared by every
// backend path where a user chooses their own password. Same convention as the
// other `constants/*` files: define the rules once, import them everywhere, never
// inline a length or a regex at a call site.
//
// Rules (agreed 2026-09-10): at least 10 characters, and at least one letter, one
// number and one symbol. The letter rule is deliberate — without it a password of
// only digits and symbols would pass. "Symbol" is anything that is not a letter
// or a digit.
//
// The frontend keeps an identical mirror (`react-inopack`
// `src/services/auth/password-policy.ts`) so the live requirements popup and the
// form validation match this gate. Keep the two rule lists in step; this one is
// the authority.
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRule {
    id: string;
    // Spanish, phrased as the requirement, so it can be listed straight back to
    // the user when a rule is unmet.
    label: string;
    test: (password: string) => boolean;
}

export const passwordRules: PasswordRule[] = [
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

export function unmetPasswordRules(password: string): PasswordRule[] {
    return passwordRules.filter((rule) => !rule.test(password));
}

export function isPasswordValid(password: string): boolean {
    return unmetPasswordRules(password).length === 0;
}

// Throws a 400 naming exactly which rules are unmet, so the response tells the
// user what to fix rather than a generic "invalid password". Every backend path
// that accepts a user-chosen password calls this — it is the real gate; the
// frontend mirror is only for immediate feedback.
export function assertPasswordStrength(password: unknown): void {
    if (typeof password !== 'string') {
        throw new BadRequestException('La contraseña no es válida.');
    }
    const unmet = unmetPasswordRules(password);
    if (unmet.length > 0) {
        throw new BadRequestException(
            `La contraseña no cumple los requisitos: ${unmet
                .map((rule) => rule.label.toLowerCase())
                .join(', ')}.`,
        );
    }
}
