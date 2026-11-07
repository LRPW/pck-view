import {forgeSystem} from '../../app/theme';
import {ChakraProvider} from "@chakra-ui/react";
import {ColorModeProvider, type ColorModeProviderProps,} from "./color-mode";

"use client"

export function Provider(props: ColorModeProviderProps) {
    return (
        <ChakraProvider value={forgeSystem}>
            <ColorModeProvider defaultTheme="dark" storageKey="pwforge:theme" enableSystem {...props} />
        </ChakraProvider>
    )
}
