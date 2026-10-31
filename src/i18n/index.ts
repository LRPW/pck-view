import {useSyncExternalStore} from 'react';

export type Language = 'ru' | 'en';
const key = 'lrpw.language';
const listeners = new Set<() => void>();

export function getLanguage(): Language {
    return localStorage.getItem(key) === 'en' ? 'en' : 'ru';
}

function notify() {
    document.documentElement.lang = getLanguage();
    listeners.forEach(listener => listener());
}

window.addEventListener('storage', event => {
    if (event.key === key) notify();
});

export function setLanguage(language: Language) {
    localStorage.setItem(key, language);
    notify();
}

export function useLanguage() {
    return useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, getLanguage);
}

const dictionary: Record<string, string> = {
    'Ошибки распаковки:': 'Extraction errors:',
    '; ошибок: ': '; errors: ',
    'Ошибка потока распаковки': 'Extraction worker failed',
    'Да': 'Yes',
    'Отмена': 'Cancel',
    'Поиск в файлах': 'Find in Files',
    'совпадений в': 'matches in',
    'Canvas недоступен': 'Canvas is unavailable',
    'Выходной архив превышает лимит одного PCK': 'The output exceeds the single PCK size limit',
    'Данные выходят за границы PCK': 'Data lies outside the PCK bounds',
    'Заголовок PCK обрезан': 'Truncated PCK header',
    'Запись ресурсов': 'Writing resources',
    'Запись таблицы': 'Writing file table',
    'Изменение зашифрованных архивов не поддерживается': 'Editing encrypted archives is unsupported',
    'Имя без терминатора': 'Unterminated filename',
    'Не выбран файл': 'No file selected',
    'Не распознан заголовок PCK': 'Unrecognized PCK header',
    'Неизвестная структура записи': 'Unknown entry structure',
    'Неизвестные guard bytes / алгоритм': 'Unknown guard bytes / algorithm',
    'Некорректная таблица файлов': 'Invalid file table',
    'Некорректное GBK имя': 'Invalid GBK filename',
    'Некорректный путь внутри архива': 'Invalid path inside archive',
    'Некорректный размер записи': 'Invalid entry size',
    'Некорректный safe header': 'Invalid safe header',
    'Неподдерживаемая версия PCK': 'Unsupported PCK version',
    'Проверка записи не прошла': 'Entry verification failed',
    'Проверка сохранённого архива': 'Verifying saved archive',
    'Проверка таблицы': 'Verifying file table',
    'Публикация файла': 'Committing file',
    'Сохранение разделённых PCK/PKX пока не поддерживается': 'Saving split PCK/PKX archives is not supported yet',
    'Таблица обрезана': 'Truncated file table',
    'Такое имя уже есть': 'This name already exists',
    'Откройте PCK, чтобы начать': 'Open a PCK to get started',
    'Поиск отменён': 'Search cancelled',
    'Поиск завершён': 'Search complete',
    ': найдено совпадений ': ': matches found: ',
    ', ошибок чтения: ': ', read errors: ',
    'Отбросить несохранённые изменения текста?': 'Discard unsaved text changes?',
    'Открыть другой архив и отбросить изменения?': 'Open another archive and discard changes?',
    'Архив открыт': 'Archive opened',
    'Изменения применены в памяти': 'Changes applied in memory',
    'Файл импортирован': 'File imported',
    'Сохранено: ': 'Saved: ',
    'Папка для распаковки PCK': 'Extract PCK to folder',
    'Распаковано ': 'Extracted ',
    ' файлов в ': ' files to ',
    'Создать архив из папки и закрыть текущий архив с изменениями?': 'Create an archive from a folder and discard changes in the current archive?',
    'Папка с ресурсами для упаковки': 'Folder to pack',
    'Сохранить PCK вне исходной папки': 'Save PCK outside the source folder',
    'Упаковано ': 'Packed ',
    ' файлов: ': ' files: ',
    'Открыть PCK': 'Open PCK',
    'Запаковать в PCK': 'Pack into PCK',
    'Распаковать всё': 'Extract all',
    'Добавить файл': 'Add file',
    'Сохранить': 'Save',
    'Сохранить как…': 'Save as…',
    'Архив не выбран': 'No archive selected',
    'Путь для добавления: folder/file.ext': 'New entry path: folder/file.ext',
    'Поиск по пути…': 'Filter by path…',
    'Предпросмотр': 'Preview',
    'Текст': 'Text',
    '\n… первые 64 KiB': '\n… first 64 KiB',
    'Применить текст': 'Apply text',
    'Заменить файлом': 'Replace from file',
    'Экспортировано: ': 'Exported: ',
    'Экспорт': 'Export',
    'Удалить ': 'Delete ',
    ' из архива?': ' from the archive?',
    'Удалить': 'Delete',
    'Файл не выбран': 'No file selected',
    'Подготовка…': 'Preparing…',
    'Выполняется…': 'Working…',
    'Обработка': 'Processing',
    'Загрузка…': 'Loading…',
    'Загрузка текстуры…': 'Loading texture…',
    'Не удалось открыть файл. Формат или кодек не поддерживается, либо файл повреждён.': 'Cannot open file. The format or codec is unsupported, or the file is damaged.',
    'Вписать': 'Fit',
    'Ресурсы': 'Resources',
    'Обновление дерева…': 'Updating tree…',
    ' файлов': ' files',
    'Файлы архива': 'Archive files',
    'Текст или регулярное выражение…': 'Text or regular expression…',
    'Включая бинарные': 'Include binary files',
    'Учитывать регистр': 'Match case',
    'Целое слово': 'Whole words',
    'Кодировка поиска': 'Search encoding',
    'Авто': 'Auto',
    'Найти': 'Find',
    'Отмена…': 'Cancelling…',
    'Остановить': 'Stop',
    'Ошибки чтения:': 'Read errors:',
    'совпадений': 'matches',
    'в': 'in',
    'файлах': 'files',
    ' · показаны первые 5000': ' · first 5000 shown',
    'Результаты поиска': 'Search results',
    'Поиск…': 'Searching…',
    'Совпадений нет': 'No matches',
    'Перейти к совпадению': 'Go to match',
    'Поиск по содержимому': 'Content search',
    'Подготовка': 'Preparing',
    'Готово': 'Done',
    'Ошибка': 'Error',
    'Открытие': 'Opening',
    'Подготовка списка': 'Preparing file list',
    'Чтение ресурса': 'Reading entry',
    'Изменение архива': 'Updating archive',
    'Сохранение': 'Saving',
    'Импорт файла': 'Importing file',
    'Экспорт файла': 'Exporting file',
    'Кодирование текста': 'Encoding text',
    'Проверка файлов': 'Checking files',
    'Распаковка': 'Extracting',
    'Упаковка': 'Packing',
    'Сканирование папки': 'Scanning folder',
    'Упаковка ресурсов': 'Packing resources',
    'Проверка архива': 'Verifying archive',
    'Запись данных': 'Writing data',
    'Запись таблицы файлов': 'Writing file table',
    'Чтение таблицы файлов': 'Reading file table',
    'Откройте архив': 'Open an archive',
    'Файл не найден': 'File not found',
    'Неизвестная кодировка': 'Unknown encoding',
    'Неизвестная кодировка поиска': 'Unknown search encoding',
    'Введите текст поиска': 'Enter a search query',
    'Размер распакованного файла не совпал': 'Uncompressed file size mismatch',
    'ожидалось': 'expected',
    'получено': 'received',
    'в PCK': 'in PCK',
    'Лимит поиска: 256 MiB на файл': 'Search limit: 256 MiB per file',
    'Лимит просмотра/экспорта: 256 MiB на файл': 'Preview/export limit: 256 MiB per file',
    'Лимит 256 MiB': '256 MiB limit',
    'Текст содержит символы, отсутствующие в GBK': 'The text contains characters that cannot be represented in GBK',
    'Имя должно помещаться в 259 байт GBK': 'The name must fit within 259 GBK bytes',
    'Недопустимый путь ресурса': 'Invalid resource path',
    'Нет каталога назначения': 'Missing destination directory',
    'Нет имени архива': 'Missing archive filename',
    'Выберите место для PCK вне упаковываемой папки': 'Choose a PCK destination outside the source folder',
    'Распаковка не может перезаписать исходный PCK/PKX': 'Extraction cannot overwrite the source PCK/PKX',
    'Путь содержит неподдерживаемые символы': 'The path contains unsupported characters',
    'Имя не помещается в GBK': 'The name cannot be represented in GBK',
    'Повторяющийся путь': 'Duplicate path',
    'Повторяющееся имя': 'Duplicate name',
    'Размер файла изменился при чтении': 'The file size changed while reading',
    'Папка превышает лимит одиночного PCK (2 ГБ)': 'The folder exceeds the single PCK limit (2 GiB)',
    'Ссылки/junction не поддерживаются': 'Links/junctions are unsupported',
    'Ссылка': 'Link',
    'Превышен размер распаковки': 'Decompression size limit exceeded',
};

export function t(text: string): string {
    if (getLanguage() === 'ru') return text;
    if (dictionary[text] !== undefined) return dictionary[text];
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (dictionary[normalized] !== undefined) return (text.startsWith(' ') ? ' ' : '') + dictionary[normalized] + (text.endsWith(' ') ? ' ' : '');
    return text;
}

const phrases = Object.keys(dictionary).filter(key => key.trim().length > 2).sort((a, b) => b.length - a.length);
const pattern = new RegExp(phrases.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

export function message(text: string): string {
    return getLanguage() === 'ru' ? text : text.replace(pattern, key => dictionary[key]);
}
