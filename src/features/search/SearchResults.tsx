import {Box, Button, Flex, Mark, Text} from '@chakra-ui/react';
import {useEffect, useRef, useState} from 'react';
import {t} from '../../i18n';
import {basename, type IdeHit} from './search-types';

const rowHeight = 26;
const overscan = 5;

export function SearchResults({matches, selected, select, open}: {
    matches: IdeHit[]; selected: number; select: (index: number) => void; open: (item: IdeHit) => void;
}) {
    const viewport = useRef<HTMLDivElement>(null);
    const [height, setHeight] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setHeight(element.clientHeight));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const element = viewport.current;
        if (!element) return;
        const top = selected * rowHeight;
        if (top < element.scrollTop) element.scrollTop = top;
        else if (top + rowHeight > element.scrollTop + element.clientHeight) {
            element.scrollTop = top + rowHeight - element.clientHeight;
        }
    }, [selected]);

    const start = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight), Math.max(0, matches.length - 1)) - overscan);
    const end = Math.min(matches.length, start + Math.ceil(height / rowHeight) + overscan * 2);
    return <Box ref={viewport} overflowY="auto" overflowX="hidden" height="full" minH="0" px="2" py="1"
                role="listbox" aria-label={t('Search results')}
                aria-activedescendant={matches[selected] ? 'search-result-' + selected : undefined}
                tabIndex={0} data-search-results onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
        {!matches.length && <Text p="3" fontSize="sm" color="fg.muted">{t('No results yet')}</Text>}
        <Box height={matches.length * rowHeight + 'px'} position="relative">
            {matches.slice(start, end).map((item, offset) => {
                const index = start + offset;
                return <Button key={index} id={'search-result-' + index} role="option"
                               aria-selected={selected === index}
                               tabIndex={-1} variant="plain" position="absolute" top={index * rowHeight + 'px'}
                               height={rowHeight + 'px'}
                               minH="0" width="full" px="2" gap="3" rounded="sm" justifyContent="space-between"
                               bg={selected === index ? 'search.selected' : 'transparent'}
                               _hover={{bg: selected === index ? 'search.selected' : 'bg.muted'}}
                               onClick={() => select(index)} onDoubleClick={() => open(item)}>
                    <Text as="code" fontSize="xs" fontWeight="normal" truncate textAlign="left" flex="1" minW="0">
                        {item.hit.before}<Mark bg="search.match" color="search.matchText" px="0.5" rounded="xs">
                        {item.hit.matched}
                    </Mark>{item.hit.after}
                    </Text>
                    <Flex gap="2" flexShrink="0" align="center" maxW="35%" fontSize="xs" color="fg.muted">
                        <Text truncate title={item.path}>{basename(item.path)}</Text><Text>{item.hit.line}</Text>
                    </Flex>
                </Button>;
            })}
        </Box>
    </Box>;
}
