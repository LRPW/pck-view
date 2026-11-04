import {ResourceWindow} from "./features/media/ResourceWindow";
import {createRoot} from 'react-dom/client';
import {ChakraProvider, defaultSystem} from '@chakra-ui/react';
import {IdeApp} from './app/IdeApp';
import {ForgeToasts} from './app/notifications';
import {IdeSearchWindow} from './features/search/IdeSearchWindow';
import './styles/app.css';

document.documentElement.classList.add('dark');
createRoot(document.getElementById('root')!).render(
    <ChakraProvider value={defaultSystem}>
        {window.location.hash.startsWith('#resource=') ? <ResourceWindow/> : window.location.hash === '#search' ?
            <IdeSearchWindow/> : <IdeApp/>}
        <ForgeToasts/>
    </ChakraProvider>
);
