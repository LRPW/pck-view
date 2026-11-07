import {createSystem, defaultConfig, defineConfig} from '@chakra-ui/react';
import {fieldAnatomy, menuAnatomy, selectAnatomy, switchAnatomy} from '@chakra-ui/react/anatomy';

// Semantic tokens keep every window and portalled popup on the same theme.
const config = defineConfig({
    theme: {
        tokens: {
            colors: {
                preview: {
                    grid: {value: 'rgba(145, 165, 190, 0.22)'},
                    background: {value: '#101720'},
                    frame: {value: '#9bb5d6'},
                    shadow: {value: '#080e17'},
                    checkerBase: {value: '#202936'},
                    checkerSquare: {value: '#2a3545'},
                    outline: {value: '#8192a8'},
                    text: {value: '#eef4ff'},
                    handleBorder: {value: '#111111'},
                },
            },
            fonts: {
                body: {value: '"Segoe UI", system-ui, sans-serif'},
                heading: {value: '"Segoe UI", system-ui, sans-serif'},
                mono: {value: 'Consolas, monospace'},
            },
        },
        semanticTokens: {
            colors: {
                search: {
                    selected: {value: {base: '{colors.blue.100}', _dark: '{colors.blue.900}'}},
                    match: {value: {base: '{colors.yellow.300}', _dark: '{colors.yellow.600}'}},
                    matchText: {value: '{colors.gray.950}'},
                },
                bg: {
                    DEFAULT: {value: {base: '#f7f8fa', _dark: '#1e1f22'}},
                    panel: {value: {base: '#ffffff', _dark: '#2b2d30'}},
                    muted: {value: {base: '#eceef2', _dark: '#25262a'}},
                    subtle: {value: {base: '#f1f2f5', _dark: '#232428'}},
                    emphasized: {value: {base: '#dfe3eb', _dark: '#35373d'}},
                },
                fg: {
                    DEFAULT: {value: {base: '#24262b', _dark: '#dfe1e5'}},
                    muted: {value: {base: '#606773', _dark: '#a8adba'}},
                    subtle: {value: {base: '#737b88', _dark: '#868c9b'}},
                },
                border: {
                    DEFAULT: {value: {base: '#d0d4dc', _dark: '#43454b'}},
                    muted: {value: {base: '#e2e5eb', _dark: '#35373d'}},
                },
            },
        },
        recipes: {
            button: {
                base: {fontWeight: 'normal', borderRadius: 'sm'},
                defaultVariants: {size: 'xs', variant: 'outline'},
            },
            input: {defaultVariants: {size: 'sm', variant: 'outline'}},
            textarea: {defaultVariants: {size: 'sm', variant: 'outline'}},
        },
        slotRecipes: {
            select: {slots: selectAnatomy.keys(), defaultVariants: {size: 'sm', variant: 'outline'}},
            switch: {slots: switchAnatomy.keys(), defaultVariants: {size: 'sm'}},
            field: {slots: fieldAnatomy.keys(), base: {label: {fontSize: 'xs', fontWeight: 'medium'}}},
            menu: {
                slots: menuAnatomy.keys(),
                base: {
                    trigger: {fontWeight: 'normal'},
                    content: {
                        bg: 'bg.panel',
                        color: 'fg',
                        borderColor: 'border',
                        borderRadius: 'md',
                        p: '1',
                        minW: '248px'
                    },
                    item: {fontSize: 'xs', minH: '7', px: '2', borderRadius: 'sm'},
                    itemCommand: {fontSize: 'xs', color: 'fg.muted', ms: 'auto'},
                },
            },
        },
    },
    globalCss: {
        'html, body': {bg: 'bg', color: 'fg', fontFamily: 'body'},
    },
});

export const forgeSystem = createSystem(defaultConfig, config);
