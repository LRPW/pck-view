import {ResourceWindow} from "./features/media/ResourceWindow";
import {createRoot} from 'react-dom/client';
import {ChakraProvider, defaultSystem} from '@chakra-ui/react';
import {App} from './app/App';
import {SearchWindow} from './features/search/SearchWindow';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
    <ChakraProvider value={defaultSystem}>
        {window.location.hash.startsWith('#resource=') ? <ResourceWindow/> : window.location.hash === '#search' ?
            <SearchWindow/> : <App/>}
    </ChakraProvider>
);
