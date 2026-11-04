import {Box, createToaster, Portal, Toast, Toaster} from '@chakra-ui/react';

export const notifications = createToaster({placement: 'bottom', offsets: {left:'12px',right:'12px',top:'12px',bottom:'32px'}, pauseOnPageIdle: true});

export function ForgeToasts() {
    return <Portal>
        <Toaster toaster={notifications} width="min(420px, calc(100vw - 24px))" marginInline="auto">
            {toast => <Toast.Root maxW="full" minW="0" paddingEnd="9">
                <Toast.Indicator/>
                <Box minW="0" flex="1" overflowWrap="anywhere" whiteSpace="normal">
                    {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                    {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
                </Box>
                <Toast.CloseTrigger aria-label="Закрыть уведомление">×</Toast.CloseTrigger>
            </Toast.Root>}
        </Toaster>
    </Portal>;
}
