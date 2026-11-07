import {useColumnWidth} from './useColumnWidth';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Button, Checkbox, Dialog, Flex, Input, Portal, Stack, Table, Text} from '@chakra-ui/react';
import {t} from '../../i18n';
import {appendDcfRow, dcfFileKey, deleteDcfRow, parseDcf, updateDcf, validateDcf} from './dcf';

export function DcfEditor({text, onChange, onOpen, disabled, entries}: {
    entries: { name: string }[];
    text: string;
    onChange: (text: string) => void;
    onOpen: (file: string) => void;
    disabled: boolean
}) {
    const columnWidths = [useColumnWidth('dcf.row', 56), useColumnWidth('dcf.file', 340), useColumnWidth('dcf.x', 110), useColumnWidth('dcf.y', 110), useColumnWidth('dcf.visible', 200), useColumnWidth('dcf.actions', 260)];
    const resize = useRef<{ index: number; start: number; width: number } | null>(null);
    const headers = ['#', t('XML file'), 'X', 'Y', t('Visible at startup'), t('Actions')];
    const minimums = [40, 120, 70, 70, 90, 100];
    const parsed = useMemo(() => parseDcf(text), [text]);
    const [filter, setFilter] = useState('');
    const [picker, setPicker] = useState<number | null>(null);
    const [query, setQuery] = useState('');
    const interfaces = useMemo(() => [...new Set(entries.map(entry => entry.name.replace(/\\/g, '/')).filter(name => /\.xml$/i.test(name)).map(name => {
        const marker = name.toLowerCase().lastIndexOf('interfaces/');
        return marker >= 0 ? name.slice(marker + 11) : name;
    }).filter(name => !/[\s"]/.test(name)))].sort((a, b) => a.localeCompare(b)), [entries]);
    const validation = useMemo(() => validateDcf(parsed.rows, interfaces), [parsed.rows, interfaces]);
    const usedFiles = useMemo(() => new Set(parsed.rows.filter(row => row.line !== picker).map(row => dcfFileKey(row.file))), [parsed.rows, picker]);
    const filteredRows = useMemo(() => parsed.rows.filter(row => row.file.toLowerCase().includes(filter.toLowerCase())), [parsed.rows, filter]);
    const viewport = useRef<HTMLDivElement>(null);
    const [windowRange, setWindowRange] = useState({start: 0, count: 24});
    const rowHeight = 80;
    const updateWindow = () => {
        const node = viewport.current;
        if (!node) return;
        const start = Math.max(0, Math.floor((node.scrollTop - 40) / rowHeight) - 6);
        const count = Math.ceil(node.clientHeight / rowHeight) + 12;
        const focused = document.activeElement;
        if (focused instanceof HTMLInputElement && node.contains(focused)) {
            const line = focused.closest('[data-dcf-line]')?.getAttribute('data-dcf-line');
            const position = filteredRows.findIndex(row => String(row.line) === line);
            if (position < start || position >= start + count) focused.blur();
        }
        setWindowRange(old => old.start === start && old.count === count ? old : {start, count});
    };
    useEffect(() => {
        const node = viewport.current;
        if (!node) return;
        const observer = new ResizeObserver(updateWindow);
        observer.observe(node);
        updateWindow();
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (viewport.current) viewport.current.scrollTop = 0;
        updateWindow();
    }, [filter]);
    const start = Math.min(windowRange.start, Math.max(0, filteredRows.length - 1));
    const end = Math.min(filteredRows.length, start + windowRange.count);
    const alreadyUsed = (file: string) => usedFiles.has(dcfFileKey(file));
    const choices = useMemo(() => picker === null ? [] : interfaces.filter(file => file.toLowerCase().includes(query.toLowerCase())), [interfaces, query, picker]);
    const choose = (file: string) => {
        if (disabled || alreadyUsed(file)) return;
        if (picker === -1) onChange(appendDcfRow(text, file));
        else {
            const row = parsed.rows.find(row => row.line === picker);
            if (row) onChange(updateDcf(text, row, 0, file));
        }
        setPicker(null);
    };
    return <Stack h="full" minH="0" gap="0">
        <Flex p="3" gap="2" borderBottomWidth="1px"><Input size="sm" maxW="sm" placeholder={t('Filter XML files')}
                                                           aria-label={t('Filter XML files')} value={filter}
                                                           onChange={event => setFilter(event.target.value)}/><Button
            size="sm" disabled={disabled} onClick={() => {
            setQuery('');
            setPicker(-1);
        }}>{t('Add row')}</Button></Flex>
        {!!parsed.invalid.length && <Text role="status" p="3" color="fg.warning"
                                          fontSize="sm">{t('Unrecognized DCF lines')}: {parsed.invalid.join(', ')}</Text>}
        <Box ref={viewport} overflow="auto" flex="1" minH="0" onScroll={updateWindow}><Table.Root size="sm" stickyHeader
                                                                                                  style={{
                                                                                                      tableLayout: 'fixed',
                                                                                                      width: columnWidths.reduce((sum, [width]) => sum + width, 0)
                                                                                                  }} css={{
            '& td': {
                overflow: 'hidden',
                height: '80px',
                boxSizing: 'border-box'
            },
            '& td p': {whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'},
            '& td button': {maxWidth: '100%'}
        }}>
            <colgroup>{columnWidths.map(([width], index) => <col key={index} style={{width}}/>)}</colgroup>
            <Table.Header><Table.Row>{headers.map((header, index) => <Table.ColumnHeader key={index} position="relative"
                                                                                         overflow="hidden"
                                                                                         whiteSpace="nowrap" pr="4">
                {header}
                <Box role="separator" aria-orientation="vertical" aria-label={t('Resize column') + ': ' + header}
                     aria-valuenow={columnWidths[index][0]} tabIndex={0}
                     position="absolute" right="0" top="0" bottom="0" width="6px" cursor="col-resize" touchAction="none"
                     bg="border" _hover={{bg: 'teal.500'}} _focusVisible={{bg: 'teal.500'}}
                     onPointerDown={event => {
                         if (event.button !== 0) return;
                         event.preventDefault();
                         resize.current = {index, start: event.clientX, width: columnWidths[index][0]};
                         event.currentTarget.setPointerCapture(event.pointerId);
                     }}
                     onPointerMove={event => {
                         const drag = resize.current;
                         if (drag?.index === index) columnWidths[index][1](Math.max(minimums[index], drag.width + event.clientX - drag.start));
                     }}
                     onPointerUp={event => {
                         resize.current = null;
                         if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                     }}
                     onPointerCancel={() => {
                         resize.current = null;
                     }} onLostPointerCapture={() => {
                    resize.current = null;
                }}
                     onKeyDown={event => {
                         if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                             event.preventDefault();
                             columnWidths[index][1](Math.max(minimums[index], columnWidths[index][0] + (event.key === 'ArrowRight' ? 10 : -10)));
                         }
                     }}/>
            </Table.ColumnHeader>)}</Table.Row></Table.Header>
            <Table.Body>
                {start > 0 && <Table.Row aria-hidden="true"><Table.Cell colSpan={6} style={{
                    height: start * rowHeight,
                    padding: 0,
                    border: 0
                }}/></Table.Row>}
                {filteredRows.slice(start, end).map(row => <Table.Row data-dcf-line={row.line} height="80px"
                                                                      key={row.line}
                                                                      bg={validation.get(row.line)?.missing ? 'red.500/10' : validation.get(row.line)?.duplicate ? 'orange.500/10' : undefined}>
                    <Table.Cell color="fg.muted">{row.line + 1}</Table.Cell>
                    <Table.Cell><Button size="sm" variant="ghost" justifyContent="start" w="full" disabled={disabled}
                                        onClick={() => {
                                            setQuery('');
                                            setPicker(row.line);
                                        }}>{row.file}</Button>
                        {validation.get(row.line)?.missing &&
                            <Text fontSize="xs" color="fg.error">{t('XML file not found in project')}</Text>}
                        {validation.get(row.line)?.duplicate &&
                            <Text fontSize="xs" color="fg.warning">{t('Duplicate interface entry')}</Text>}
                    </Table.Cell>
                    {(['x', 'y'] as const).map((axis, index) => <Table.Cell key={axis}><Input key={row[axis]} size="sm"
                                                                                              type="number" step="1"
                                                                                              w="full" minW="0"
                                                                                              defaultValue={row[axis]}
                                                                                              disabled={disabled}
                                                                                              aria-label={axis.toUpperCase()}
                                                                                              onBlur={event => {
                                                                                                  const value = event.target.value;
                                                                                                  if (/^-?\d+$/.test(value) && Number(value) !== row[axis]) onChange(updateDcf(text, row, index + 1, value)); else event.target.value = String(row[axis]);
                                                                                              }} onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                    }}/></Table.Cell>)}
                    <Table.Cell><Checkbox.Root checked={row.visible} disabled={disabled}
                                               onCheckedChange={event => onChange(updateDcf(text, row, 3, event.checked === true ? '1' : '0'))}><Checkbox.HiddenInput
                        aria-label={t('Visible at startup')}/><Checkbox.Control><Checkbox.Indicator/></Checkbox.Control></Checkbox.Root></Table.Cell>
                    <Table.Cell><Button size="xs" variant="ghost" disabled={validation.get(row.line)?.missing}
                                        onClick={() => onOpen(row.file)}>{t('Open interface')}</Button><Button size="xs"
                                                                                                               variant="ghost"
                                                                                                               colorPalette="red"
                                                                                                               disabled={disabled}
                                                                                                               aria-label={t('Delete row') + ': ' + row.file}
                                                                                                               onClick={() => onChange(deleteDcfRow(text, row))}>{t('Delete row')}</Button></Table.Cell>
                </Table.Row>)}
                {end < filteredRows.length && <Table.Row aria-hidden="true"><Table.Cell colSpan={6} style={{
                    height: (filteredRows.length - end) * rowHeight,
                    padding: 0,
                    border: 0
                }}/></Table.Row>}
            </Table.Body>
        </Table.Root></Box>
        <Dialog.Root open={picker !== null} onOpenChange={event => {
            if (!event.open) setPicker(null);
        }}>
            <Portal><Dialog.Backdrop/><Dialog.Positioner><Dialog.Content>
                <Dialog.Header><Dialog.Title>{t('Select interface')}</Dialog.Title></Dialog.Header>
                <Dialog.Body><Stack gap="3"><Input autoFocus placeholder={t('Filter XML files')}
                                                   aria-label={t('Filter XML files')} value={query}
                                                   onChange={event => setQuery(event.target.value)}/>
                    <Stack maxH="50vh" overflowY="auto" gap="1">{choices.slice(0, 100).map(file => <Button key={file}
                                                                                                           variant="ghost"
                                                                                                           size="sm"
                                                                                                           justifyContent="start"
                                                                                                           flexShrink="0"
                                                                                                           disabled={alreadyUsed(file)}
                                                                                                           onClick={() => choose(file)}>{file}{alreadyUsed(file) ? ' · ' + t('Already added') : ''}</Button>)}
                        {!choices.length && <Text color="fg.muted">{t('No interfaces found')}</Text>}</Stack>
                </Stack></Dialog.Body>
                <Dialog.Footer><Button variant="outline"
                                       onClick={() => setPicker(null)}>{t('Close')}</Button></Dialog.Footer>
            </Dialog.Content></Dialog.Positioner></Portal>
        </Dialog.Root>
        <Text p="2" fontSize="xs" color="fg.muted">{t('Interfaces')}: {parsed.rows.length}</Text>
    </Stack>;
}
