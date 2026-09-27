import PetsIcon from '@mui/icons-material/AccessTimeFilledOutlined';
import { Grid } from '@mui/material';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import * as React from 'react';
import { DAnimatedBox } from '../../dum';

interface IAuthScreenLayoutProps {
    // The heading over the form ("Ingresar", "Código de verificación", …). Each
    // login step reuses this shell so the three screens read as one flow rather
    // than three unrelated pages.
    title: string;
    // The `<form>` element with its fields and buttons. Kept as children so each
    // step owns its own submit handler and validation.
    children: React.ReactNode;
}

// The centred card that every step of the login flow renders inside: the avatar,
// the title, and whatever form the step supplies. Extracted from the original
// single login form so the MFA and password-change steps look identical without
// copying the layout three times.
export function AuthScreenLayout({ title, children }: IAuthScreenLayoutProps) {
    return (
        <DAnimatedBox>
            <Grid
                container
                spacing={0}
                sx={{
                    minHeight: '100vh',
                    flexDirection: ['column', 'column', 'row'],
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
            >
                <Grid
                    container
                    size="grow"
                    sx={{
                        alignSelf: ['center', 'center', 'auto'],
                        flexDirection: 'column',
                        alignContent: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                        }}
                    >
                        <Avatar sx={{ m: 1, bgcolor: 'primary.main' }}>
                            <PetsIcon />
                        </Avatar>
                        <Typography component="h1" variant="h5">
                            {title}
                        </Typography>
                        {children}
                    </Box>
                </Grid>
            </Grid>
        </DAnimatedBox>
    );
}
