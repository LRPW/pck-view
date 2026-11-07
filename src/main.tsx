import {lazy, Suspense} from 'react';
import {Provider as ReduxProvider} from 'react-redux';
import {store} from './store';
import {t, useLanguage} from "./i18n";
import {createRoot} from 'react-dom/client';
import {IdeApp} from './app/IdeApp';
import {ForgeToasts} from './app/notifications';
import {SettingsWindow} from './app/SettingsWindow';
import {Provider} from './components/ui/provider';
import './styles/app.css';

const ResourceWindow = lazy(() => import('./features/media/ResourceWindow').then(module => ({default: module.ResourceWindow})));
const IdeSearchWindow = lazy(() => import('./features/search/IdeSearchWindow').then(module => ({default: module.IdeSearchWindow})));

function Application() {
    useLanguage();

    return <>

        <Provider>
            <Suspense fallback={<div role="status">{t('Loading…')}</div>}>
                {window.location.hash === '#settings' ?
                    <SettingsWindow/> : window.location.hash.startsWith('#resource=') ?
                        <ResourceWindow/> : window.location.hash === '#search' ?
                            <IdeSearchWindow/> : <IdeApp/>}
            </Suspense>
            <ForgeToasts/>
        </Provider>
    </>;
}

createRoot(document.getElementById('root')!).render(<ReduxProvider store={store}><Application/></ReduxProvider>);
