import {
    Box,
    Button,
    Collapse,
    Divider,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    SwipeableDrawer as MuiDrawer,
    Toolbar,
} from '@mui/material';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { routeItems } from '../../pages';
import { ExpandLess, ExpandMore } from '@mui/icons-material';
import { DConfirmationModal, DNavListItemLink } from '../../dum';
import { useCurrentUserQuery, RoleId } from '../../../services';
import {
    isRouteGroup,
    routeNavbarAuthFilter,
    routeNavbarFilter,
} from '../../../types';
import inopackLogo from '../inopack-app-bar/logo.png';
import LogoutIcon from '@mui/icons-material/Logout';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { useDevState } from '../../../helpers';
import { ColorModeContext } from '../providers/custom-theme-provider';
import { ConnectionStatusListItem } from './connection-status-list-item';
import { navigateToActivitiesPage } from '../../../services';
import { logoutSession } from '../../../services/auth/access-token';
import { useAppDispatch } from '../../hooks';
import { pushMessage } from '../../../features/global-messages/global-messages-slice';

interface IDrawer {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggleDrawer: () => void;
    isDesktop: boolean;
}

const drawerWidth: number = 240;

export const InopackDrawer = (props: IDrawer) => {
    const { open, setOpen, isDesktop } = props;

    const location = useLocation();
    const navigate = useNavigate();

    const [activeList, setActiveList] = useState<string | null>(null);
    const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

    const { data } = useCurrentUserQuery();
    const dispatch = useAppDispatch();

    const currentUser = data?.currentUser;

    const isDevEnvironment = useDevState();
    const { mode, toggleColorMode } = React.useContext(ColorModeContext);

    const routeFilter = useMemo(() => {
        return currentUser
            ? routeNavbarAuthFilter(currentUser)
            : routeNavbarFilter();
    }, [currentUser]);

    // Activities is a cross-domain view: Super, General and Asistente General only.
    const canSeeActivities =
        !!currentUser &&
        [RoleId.Super, RoleId.Admin, RoleId.Guest].some((roleId) =>
            currentUser.role_ids.includes(roleId),
        );

    useEffect(() => {
        const staticRouteGroup = routeItems.find((rg) => {
            return isRouteGroup(rg)
                ? rg.routes.find((route) => {
                      return location.pathname.includes(route.path);
                  })
                : location.pathname.includes(rg.path);
        });
        setActiveList(staticRouteGroup ? staticRouteGroup.title : null);
    }, [setActiveList, location]);

    return (
        <MuiDrawer
            className={'no-printable-block'}
            variant={isDesktop ? 'permanent' : 'temporary'}
            open={open}
            onClose={() => {
                setOpen(false);
            }}
            onOpen={() => {
                setOpen(true);
            }}
            sx={{
                width: drawerWidth,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: {
                    width: drawerWidth,
                    boxSizing: 'border-box',
                },
            }}
        >
            <Toolbar
                color={'primary'}
                sx={{
                    bgcolor: isDevEnvironment
                        ? 'secondary.main'
                        : 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    px: [1],
                }}
            >
                <Button sx={{ p: 0, m: 0 }} size={'small'} onClick={() => navigate('/')}>
                    <Box
                        component={'img'}
                        src={inopackLogo}
                        sx={{
                            maxWidth: '10rem',
                            filter: mode === 'dark' ? 'brightness(0) invert(1)' : 'none',
                        }}
                    />
                </Button>
                {/*<IconButton onClick={toggleDrawer}>*/}
                {/*    <ChevronLeftIcon />*/}
                {/*</IconButton>*/}
            </Toolbar>
            {routeItems.filter(routeFilter).map((rg, index) => {
                return (
                    <React.Fragment key={index}>
                        <List>
                            {isRouteGroup(rg) ? (
                                <ListItemButton
                                    onClick={() => {
                                        setActiveList(
                                            rg.title !== activeList
                                                ? rg.title
                                                : null,
                                        );
                                    }}
                                >
                                    <ListItemText primary={rg.title} />
                                    {activeList === rg.title ? (
                                        <ExpandLess />
                                    ) : (
                                        <ExpandMore />
                                    )}
                                </ListItemButton>
                            ) : (
                                <DNavListItemLink
                                    key={rg.name}
                                    primary={rg.title}
                                    exact={rg.exact || false}
                                    to={rg.path}
                                    onClick={() => {
                                        setOpen(false);
                                    }}
                                />
                            )}

                            {isRouteGroup(rg) ? (
                                <Collapse in={activeList === rg.title}>
                                    <List>
                                        {rg.routes
                                            .filter(routeFilter)
                                            .map((route) => {
                                                return (
                                                    <DNavListItemLink
                                                        key={route.name}
                                                        primary={route.title}
                                                        exact={
                                                            route.exact || false
                                                        }
                                                        to={route.path}
                                                        onClick={() => {
                                                            setOpen(false);
                                                        }}
                                                    />
                                                );
                                            })}
                                    </List>
                                </Collapse>
                            ) : null}
                        </List>
                        <Divider />
                    </React.Fragment>
                );
            })}
            <List style={{ marginTop: `auto` }}>
                <ConnectionStatusListItem />
                <Divider />
                {canSeeActivities && (
                    <ListItemButton
                        dense
                        onClick={() => {
                            navigateToActivitiesPage({ navigate });
                            setOpen(false);
                        }}
                    >
                        <ListItemIcon>
                            <NotificationsIcon />
                        </ListItemIcon>
                        <ListItemText>Actividades</ListItemText>
                    </ListItemButton>
                )}
                <ListItemButton dense onClick={toggleColorMode}>
                    <ListItemIcon>
                        {mode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
                    </ListItemIcon>
                    <ListItemText>{mode === 'light' ? 'Modo oscuro' : 'Modo claro'}</ListItemText>
                </ListItemButton>
                <ListItemButton
                    dense
                    onClick={() => {
                        setLogoutConfirmOpen(true);
                    }}
                >
                    <ListItemIcon>
                        <LogoutIcon />
                    </ListItemIcon>
                    <ListItemText>Cerrar sesión</ListItemText>
                </ListItemButton>
            </List>
            <DConfirmationModal
                open={logoutConfirmOpen}
                setOpen={setLogoutConfirmOpen}
                title={'Cerrar sesión'}
                message={'¿Seguro que quieres cerrar sesión?'}
                confirmLabel={'Cerrar sesión'}
                callback={() => {
                    // Server-side revocation first: dropping the token locally
                    // would leave the refresh family alive, so anyone holding
                    // the cookie could keep minting access tokens. The reload
                    // then clears every in-memory cache; the bootstrap refresh
                    // comes back 401 and the login screen appears.
                    void logoutSession().then((loggedOut) => {
                        if (!loggedOut) {
                            // Reloading here would be a lie: the httpOnly
                            // cookie is still alive and the bootstrap refresh
                            // would put the user straight back in, having just
                            // told them they left. Say so and stay put — the
                            // session they are in still works.
                            dispatch(
                                pushMessage({
                                    message:
                                        'No se pudo cerrar la sesión, intenta de nuevo',
                                    options: { variant: 'error' },
                                }),
                            );
                            return;
                        }
                        window.location.reload();
                    });
                }}
            />
        </MuiDrawer>
    );
};
