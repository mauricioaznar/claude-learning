import { useEffect, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import { LoginOutcome } from '../../../services/auth/access-token';
import { CredentialsForm } from './credentials-form';
import { MfaCodeForm } from './mfa-code-form';
import { PasswordChangeForm } from './password-change-form';

// The login flow is a small state machine. The password step can branch into an
// email-MFA step or a forced-password-change step, and the password-change step
// can itself branch into MFA (an account may enforce both). Each non-initial
// step carries the short-lived interstitial token that authorises its endpoint —
// held here in component state, so it lives in memory only and dies with the
// attempt, never touching localStorage.
type LoginStep =
    | { name: 'credentials' }
    | { name: 'mfa'; mfaToken: string }
    | { name: 'passwordChange'; changeToken: string };

// The application's login screen. It owns the flow state and the single
// "session is now real" action; the individual screens are dumb steps that
// report their outcome back up.
export default function LoginForm() {
    const [step, setStep] = useState<LoginStep>({ name: 'credentials' });
    const client = useApolloClient();

    // Cleanup for anyone whose plaintext password is still sitting in
    // localStorage from before it stopped being persisted. CRA's production
    // build mangles function names, so the old key is not stable across builds —
    // sweep by suffix, which matches every build's key. Runs once on mount,
    // independent of which step is showing.
    useEffect(() => {
        // Collect first, remove after: removing during the loop shifts the
        // remaining indices and would skip keys.
        const staleKeys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.slice(-9) === '_Password') {
                staleKeys.push(key);
            }
        }
        for (let i = 0; i < staleKeys.length; i++) {
            window.localStorage.removeItem(staleKeys[i]);
        }
    }, []);

    // The one place a real session begins. Resetting the store refetches every
    // active query — including `currentUser`, which AuthorizationWrapper is
    // waiting on — so the app swaps itself in without tearing the page down (no
    // `window.location.reload()`). A refetch hiccup must not throw the user out,
    // so failures are only logged: the session already exists at this point.
    async function finishLogin() {
        try {
            await client.resetStore();
        } catch (e: unknown) {
            console.error(e);
        }
    }

    // Shared routing for the two steps that can end in more than one way (the
    // password step and the password-change step). Keeping it in one place means
    // "a password change that still needs MFA" and "a login that needs MFA" take
    // the identical path.
    function handleOutcome(outcome: LoginOutcome) {
        if (outcome.status === 'authenticated') {
            void finishLogin();
        } else if (outcome.status === 'mfaRequired') {
            setStep({ name: 'mfa', mfaToken: outcome.mfaToken });
        } else {
            setStep({
                name: 'passwordChange',
                changeToken: outcome.changeToken,
            });
        }
    }

    if (step.name === 'mfa') {
        return (
            <MfaCodeForm
                mfaToken={step.mfaToken}
                onAuthenticated={finishLogin}
            />
        );
    }

    if (step.name === 'passwordChange') {
        return (
            <PasswordChangeForm
                changeToken={step.changeToken}
                onOutcome={handleOutcome}
            />
        );
    }

    return <CredentialsForm onOutcome={handleOutcome} />;
}
