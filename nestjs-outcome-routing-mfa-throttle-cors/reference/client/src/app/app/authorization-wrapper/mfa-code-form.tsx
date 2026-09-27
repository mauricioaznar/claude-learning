import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import * as React from 'react';
import { useState } from 'react';
import {
    resendMfaCode,
    verifyMfaCode,
} from '../../../services/auth/access-token';
import { useAppDispatch } from '../../hooks';
import { pushMessage } from '../../../features/global-messages/global-messages-slice';
import { AuthScreenLayout } from './auth-screen-layout';

interface IMfaCodeFormProps {
    // The short-lived token that authorises the verify/resend endpoints. Held in
    // the orchestrator's state (memory only) and passed straight through.
    mfaToken: string;
    // Called after a code verifies and the access token is adopted, so the
    // orchestrator can bootstrap the session exactly as a plain login does.
    onAuthenticated: () => void;
}

// Step 2a of the login flow: email MFA. A 6-digit code was emailed when the
// password check returned `mfaRequired`; the user types it here. A wrong or
// expired code shows the server's Spanish message and keeps the user on this
// screen — it never drops them back to the password form (that would mean
// re-entering the password and issuing a fresh code for no reason).
export function MfaCodeForm({ mfaToken, onAuthenticated }: IMfaCodeFormProps) {
    const [code, setCode] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isResending, setIsResending] = useState(false);

    const dispatch = useAppDispatch();

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsVerifying(true);

        try {
            await verifyMfaCode(mfaToken, code.trim());
            onAuthenticated();
        } catch (e: unknown) {
            setIsVerifying(false);
            dispatch(
                pushMessage({
                    message:
                        e instanceof Error
                            ? e.message
                            : 'No se pudo verificar el código',
                    options: { variant: 'error' },
                }),
            );
            console.error(e);
        }
    }

    async function handleResend() {
        setIsResending(true);
        try {
            await resendMfaCode(mfaToken);
            dispatch(
                pushMessage({
                    message: 'Te enviamos un nuevo código',
                    options: { variant: 'success' },
                }),
            );
        } catch (e: unknown) {
            dispatch(
                pushMessage({
                    message:
                        e instanceof Error
                            ? e.message
                            : 'No se pudo reenviar el código',
                    options: { variant: 'error' },
                }),
            );
            console.error(e);
        } finally {
            setIsResending(false);
        }
    }

    return (
        <AuthScreenLayout title={'Código de verificación'}>
            <Box
                component={'form'}
                onSubmit={handleSubmit}
                noValidate
                sx={{ mt: 1 }}
            >
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1, textAlign: 'center' }}
                >
                    Enviamos un código a tu correo. Escríbelo para continuar.
                </Typography>
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="code"
                    label="Código"
                    id="code"
                    autoFocus
                    autoComplete={'one-time-code'}
                    inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                    value={code}
                    onChange={(e) => {
                        setCode(e.target.value);
                    }}
                />
                <Button
                    disabled={isVerifying || code.trim().length === 0}
                    type="submit"
                    fullWidth
                    variant="contained"
                    sx={{ mt: 3, mb: 1 }}
                >
                    Verificar
                </Button>
                <Button
                    disabled={isResending}
                    type="button"
                    fullWidth
                    variant="text"
                    onClick={handleResend}
                    sx={{ mb: 2 }}
                >
                    Reenviar código
                </Button>
            </Box>
        </AuthScreenLayout>
    );
}
