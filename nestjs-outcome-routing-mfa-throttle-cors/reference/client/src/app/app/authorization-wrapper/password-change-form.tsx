import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import * as React from 'react';
import { useState } from 'react';
import {
    changePasswordWithToken,
    LoginOutcome,
} from '../../../services/auth/access-token';
import {
    evaluatePassword,
    isPasswordValid,
} from '../../../services/auth/password-policy';
import { PasswordRequirementsPopover } from '../../dum';
import { useAppDispatch } from '../../hooks';
import { pushMessage } from '../../../features/global-messages/global-messages-slice';
import { AuthScreenLayout } from './auth-screen-layout';

// The single Spanish message shown when the new password fails the policy; the
// live requirements popup shows which specific rule is still unmet. The rules
// themselves live in the shared policy module (mirrored on the backend, which is
// the real gate).
const PASSWORD_POLICY_MESSAGE =
    'La contraseña debe tener al menos 10 caracteres, una letra, un número y un símbolo';

interface IPasswordChangeFormProps {
    // The short-lived token authorising the change endpoint. Memory only.
    changeToken: string;
    // The change can end in a session OR — for an account that also enforces
    // MFA — in the MFA step, so the orchestrator routes on the outcome just like
    // it does for a plain login.
    onOutcome: (outcome: LoginOutcome) => void;
}

// Step 2b of the login flow: forced password change. Reached when a super-user
// reset flagged the account; the password verified, but a new one must be set
// before any token is issued.
export function PasswordChangeForm({
    changeToken,
    onOutcome,
}: IPasswordChangeFormProps) {
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [isDisabled, setIsDisabled] = useState(false);
    // Anchor for the live requirements popup — set while the new-password field
    // is focused, so the checklist shows only then.
    const [passwordAnchor, setPasswordAnchor] = useState<HTMLElement | null>(
        null,
    );

    const dispatch = useAppDispatch();

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!isPasswordValid(password)) {
            dispatch(
                pushMessage({
                    message: PASSWORD_POLICY_MESSAGE,
                    options: { variant: 'error' },
                }),
            );
            return;
        }
        if (password !== confirmation) {
            dispatch(
                pushMessage({
                    message: 'Las contraseñas no coinciden',
                    options: { variant: 'error' },
                }),
            );
            return;
        }

        setIsDisabled(true);
        try {
            const outcome = await changePasswordWithToken(changeToken, password);
            onOutcome(outcome);
            setIsDisabled(false);
        } catch (e: unknown) {
            setIsDisabled(false);
            dispatch(
                pushMessage({
                    message:
                        e instanceof Error
                            ? e.message
                            : 'No se pudo cambiar la contraseña',
                    options: { variant: 'error' },
                }),
            );
            console.error(e);
        }
    }

    return (
        <AuthScreenLayout title={'Cambiar contraseña'}>
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
                    Debes establecer una nueva contraseña para continuar.
                </Typography>
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="new-password"
                    label="Nueva contraseña"
                    id="new-password"
                    type={'password'}
                    autoFocus
                    autoComplete={'new-password'}
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                    }}
                    onFocus={(e) => setPasswordAnchor(e.currentTarget)}
                    onBlur={() => setPasswordAnchor(null)}
                />
                <PasswordRequirementsPopover
                    open={Boolean(passwordAnchor)}
                    anchorEl={passwordAnchor}
                    rules={evaluatePassword(password)}
                />
                <TextField
                    margin="normal"
                    required
                    fullWidth
                    name="confirm-password"
                    label="Confirmar contraseña"
                    id="confirm-password"
                    type={'password'}
                    autoComplete={'new-password'}
                    value={confirmation}
                    onChange={(e) => {
                        setConfirmation(e.target.value);
                    }}
                />
                <Button
                    disabled={isDisabled}
                    type="submit"
                    fullWidth
                    variant="contained"
                    sx={{ mt: 3, mb: 2 }}
                >
                    Guardar
                </Button>
            </Box>
        </AuthScreenLayout>
    );
}
