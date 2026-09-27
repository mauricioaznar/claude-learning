import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import * as React from 'react';
import { useState } from 'react';
import {
    loginWithPassword,
    LoginOutcome,
} from '../../../services/auth/access-token';
import { useString } from '../../../helpers';
import { useAppDispatch } from '../../hooks';
import { pushMessage } from '../../../features/global-messages/global-messages-slice';
import { AuthScreenLayout } from './auth-screen-layout';

interface ICredentialsFormProps {
    // Reports what the server decided: a session, an MFA step, or a forced
    // password change. The orchestrator (`LoginForm`) routes on it.
    onOutcome: (outcome: LoginOutcome) => void;
}

// Step 1 of the login flow: email + password. This is the original login form,
// unchanged in look; the only difference is that a successful POST no longer
// means "logged in" — it means "the server has decided what happens next", which
// this hands up via `onOutcome`.
export function CredentialsForm({ onOutcome }: ICredentialsFormProps) {
    const [isDisabled, setIsDisabled] = useState(false);

    const [username, setUsername] = useString({
        KEY: 'LoginForm_Username',
        defaultValue: '',
    });
    // Plain state, not `useString`. `useString` persists to localStorage, so
    // this field would otherwise write the user's plaintext password into
    // localStorage on every keystroke. The email is a convenience worth
    // persisting; the password never was.
    const [password, setPassword] = useState('');

    const dispatch = useAppDispatch();

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsDisabled(true);

        try {
            // REST rather than a GraphQL mutation: the response has to carry a
            // `Set-Cookie` for the httpOnly refresh token, which the GraphQL
            // transport cannot do portably.
            const outcome = await loginWithPassword(username, password);
            onOutcome(outcome);
            // On `mfaRequired` / `passwordChangeRequired` the orchestrator swaps
            // this screen out, so re-enabling the button is only meaningful for
            // the (already-swapped) authenticated case; harmless either way.
            setIsDisabled(false);
        } catch (e: unknown) {
            setIsDisabled(false);
            // A failed login no longer travels through Apollo, so the error link
            // is not there to surface it — say it here. The message stays generic
            // on purpose: the server does not distinguish unknown user, wrong
            // password, or a locked account.
            dispatch(
                pushMessage({
                    message: 'No se pudo iniciar sesión con esos datos',
                    options: { variant: 'error' },
                }),
            );
            console.error(e);
        }
    }

    return (
        <AuthScreenLayout title={'Ingresar'}>
            <Box
                component={'form'}
                onSubmit={handleSubmit}
                noValidate
                sx={{ mt: 1 }}
            >
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    id="color"
                    label="Email"
                    name="username"
                    autoFocus
                    autoComplete={'email'}
                    value={username}
                    onChange={(e) => {
                        setUsername(e.target.value);
                    }}
                />
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="password"
                    label="Contraseña"
                    autoComplete={'password'}
                    id="password"
                    type={'password'}
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                    }}
                />
                <Button
                    disabled={isDisabled}
                    type="submit"
                    fullWidth
                    variant="contained"
                    sx={{ mt: 3, mb: 2 }}
                >
                    Aceptar
                </Button>
            </Box>
        </AuthScreenLayout>
    );
}
