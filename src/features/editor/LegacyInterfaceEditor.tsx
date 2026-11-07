import {useMemo, useState} from 'react';
import {Box, Button, Field, Flex, Input, Stack, Table, Text, Textarea} from '@chakra-ui/react';
import {message, t} from '../../i18n';
import {legacyRows, type LegacyToken, replaceLegacyToken} from './legacy-interface';

export function LegacyInterfaceEditor({text, format, onChange, disabled}: {
    text: string;
    format: string;
    onChange: (value: string) => void;
    disabled: boolean
}) {
    const [filter, setFilter] = useState(''), [page, setPage] = useState(0), [selected, setSelected] = useState(0), [error, setError] = useState('');
    const parsed = useMemo(() => {
        try {
            return {rows: legacyRows(text, format), error: ''};
        } catch (e) {
            return {rows: [], error: e instanceof Error ? e.message : String(e)};
        }
    }, [text, format]);
    const rows = parsed.rows.filter(row => row.some(token => token.value.toLowerCase().includes(filter.toLowerCase())));
    const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
    const edit = (token: LegacyToken, value: string) => {
        try {
            if (format === 'stf' && token === parsed.rows.find(row => row[0] === token)?.[0] && !/^-?\d+$/.test(value)) throw Error('Invalid string ID');
            onChange(replaceLegacyToken(text, token, value));
            setError('');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    const remove = (row: LegacyToken[]) => onChange(text.slice(0, row[0].start) + text.slice(row.at(-1)!.end));
    const input = (token: LegacyToken, label: string) => <Input key={token.start + ':' + token.value} size="sm"
                                                                aria-label={label} disabled={disabled}
                                                                defaultValue={token.value} onBlur={event => {
        if (event.target.value !== token.value) edit(token, event.target.value);
    }} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur();
    }}/>;
    return <Stack h="full" minH="0" gap="0">
        <Flex p="3" gap="2" borderBottomWidth="1px"><Input size="sm" placeholder={t('Search')} aria-label={t('Search')}
                                                           value={filter} onChange={event => {
            setFilter(event.target.value);
            setPage(0);
        }}/>
            {format !== 'dtf' && <Button size="sm" disabled={disabled} onClick={() => {
                const ids = new Set(parsed.rows.map(row => row[0].value));
                let id = 1;
                while (ids.has(String(id))) id++;
                const key = format === 'stf' ? String(id) : 'Control_' + id;
                onChange(text + (text && !/[\r\n]$/.test(text) ? '\r\n' : '') + (format === 'stf' ? key : '"' + key + '"') + '\t""\r\n');
            }}>{t('Add row')}</Button>}
        </Flex>
        {(error || parsed.error) && <Text p="2" color="fg.error" role="alert">{message(error || parsed.error)}</Text>}
        <Flex flex="1" minH="0">
            <Box flex="1" overflow="auto"><Table.Root size="sm"
                                                      stickyHeader><Table.Header><Table.Row><Table.ColumnHeader>{format === 'dtf' ? t('Element type') : format === 'stf' ? t('String ID') : t('Control name')}</Table.ColumnHeader><Table.ColumnHeader>{format === 'dtf' ? t('Element name') : t('Text')}</Table.ColumnHeader><Table.ColumnHeader/></Table.Row></Table.Header>
                <Table.Body>{rows.slice(currentPage * 50, currentPage * 50 + 50).map(row => <Table.Row
                    key={row[0].start}
                    bg={format === 'dtf' && selected === parsed.rows.indexOf(row) ? 'bg.subtle' : undefined}
                    onClick={() => setSelected(parsed.rows.indexOf(row))}>
                    <Table.Cell>{format === 'dtf' ? row[0].value : input(row[0], t('String ID'))}</Table.Cell>
                    <Table.Cell>{format === 'dtf' ? row[1]?.value :
                        <Textarea key={row[1].start + ':' + row[1].value} size="sm" minH="16" disabled={disabled}
                                  defaultValue={row[1].value} onBlur={event => {
                            if (event.target.value !== row[1].value) edit(row[1], event.target.value);
                        }}/>}</Table.Cell>
                    <Table.Cell><Button size="xs" variant="ghost" disabled={disabled}
                                        onClick={() => remove(row)}>{t('Delete row')}</Button></Table.Cell>
                </Table.Row>)}</Table.Body></Table.Root></Box>
            {format === 'dtf' && parsed.rows[selected] && <Stack w="320px" overflow="auto" p="3" borderLeftWidth="1px">
                {parsed.rows[selected].map((token, index) => {
                    const type = parsed.rows[selected][0].value.toUpperCase();
                    const labels = type === 'DIALOG' ? ['Element type', 'Element name', 'X', 'Y', 'Width', 'Height'] : ['Element type', 'Element name', 'Command', 'Hint', 'X', 'Y', 'Width', 'Height'];
                    const label = t(labels[index] ?? 'Parameter') + (index >= labels.length ? ' ' + (index + 1) : '');
                    return <Field.Root key={index}><Field.Label fontSize="xs">{label}</Field.Label>{index === 0 ?
                        <Text>{token.value}</Text> : input(token, label)}</Field.Root>;
                })}
            </Stack>}
        </Flex>
        <Flex p="2" align="center" gap="3"><Button size="xs" disabled={!currentPage}
                                                   onClick={() => setPage(currentPage - 1)}>{t('Previous')}</Button><Text
            fontSize="xs">{currentPage + 1} / {Math.max(1, Math.ceil(rows.length / 50))}</Text><Button size="xs"
                                                                                                       disabled={(currentPage + 1) * 50 >= rows.length}
                                                                                                       onClick={() => setPage(currentPage + 1)}>{t('Next')}</Button></Flex>
    </Stack>;
}
