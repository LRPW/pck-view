import {Alert, Flex, Skeleton, Stack, Text} from '@chakra-ui/react';
import {invoke} from '@tauri-apps/api/core';
import {useEffect, useRef, useState} from 'react';
import {message, t} from '../../i18n';
import {TextEditor, type TextEditorHandle} from '../editor/TextEditor';
import {basename, type IdeHit} from './search-types';

const readOnlyChange = () => {
};

export function SearchPreview({item}: { item?: IdeHit }) {
    const editor = useRef<TextEditorHandle>(null);
    const [text, setText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let disposed = false;
        if (!item) {
            setText('');
            return;
        }
        setLoading(true);
        setError('');
        void invoke<ArrayBuffer>('ide_search_preview', {
            source: item.source,
            path: item.path,
            structured: !!item.structured
        })
            .then(bytes => {
                if (!disposed) setText(new TextDecoder(item.structured ? 'utf-8' : item.hit.encoding).decode(bytes));
            })
            .catch(error => {
                if (!disposed) setError(String(error));
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });
        return () => {
            disposed = true;
        };
    }, [item?.source, item?.path, item?.hit.encoding, item?.structured]);

    useEffect(() => {
        if (!loading && !error && item) editor.current?.reveal(item.hit.start, item.hit.end, false);
    }, [text, loading, error, item?.hit.start, item?.hit.end]);

    return <Stack gap="0" minH="0" height="full" bg="bg">
        <Flex px="3" py="2" gap="2" align="center" borderBottomWidth="1px" minW="0">
            <Text fontSize="xs" flexShrink="0">{item ? basename(item.path) : t('Preview')}</Text>
            {item && <Text fontSize="xs" color="fg.muted" truncate title={item.path}>{item.path}</Text>}
        </Flex>
        {!item ? <Text p="4" fontSize="sm" color="fg.muted">{t('Select a result to preview the file')}</Text> :
            loading ? <Stack p="4" gap="2">{[80, 65, 90, 45].map((width, index) =>
                    <Skeleton key={index} height="4" width={width + '%'}/>)}</Stack> :
                error ? <Alert.Root status="warning"
                                    size="sm"><Alert.Indicator/><Alert.Content>{message(error)}</Alert.Content></Alert.Root> :
                    <TextEditor ref={editor} fileName={item.path} value={text} readOnly onChange={readOnlyChange}/>}
    </Stack>;
}
