import {t} from '../../i18n';
import {createListCollection} from '@chakra-ui/react';
import {Children, isValidElement, type ReactNode} from 'react';

type Option = { value?: string | number; disabled?: boolean; children?: ReactNode };

function label(children: ReactNode, translated = false): string {
    return Children.toArray(children).map(child => isValidElement<Option>(child) ? label(child.props.children, translated) : translated ? t(String(child)) : String(child)).join('');
}

// Client data uses numeric IDs and conditional option lists. Convert that data
// to Chakra's collection without introducing another select component.
export function selectCollection(children: ReactNode) {
    const options: { value: string; label: string; disabled: boolean }[] = [];

    function visit(nodes: ReactNode) {
        Children.forEach(nodes, node => {
            if (!isValidElement<Option>(node)) return;
            if (node.type === 'option') {
                const text = label(node.props.children);
                options.push({
                    value: String(node.props.value ?? text),
                    label: label(node.props.children, true),
                    disabled: !!node.props.disabled
                });
            } else visit(node.props.children);
        });
    }

    visit(children);
    return createListCollection({items: options});
}
