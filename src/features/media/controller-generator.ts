const controls: Record<string, string> = {
    STILLIMAGEBUTTON: 'AUIStillImageButton',
    LABEL: 'AUILabel',
    EDIT: 'AUIEditBox',
    IMAGEPICTURE: 'AUIImagePicture',
    CHECK: 'AUICheckBox',
    RADIO: 'AUIRadioButton',
    LIST: 'AUIListBox',
    COMBO: 'AUIComboBox',
    TREE: 'AUITreeView',
    PROGRESS: 'AUIProgress',
    SLIDER: 'AUISlider',
    SCROLL: 'AUIScroll',
    TEXT: 'AUITextArea',
    VERTICALTEXT: 'AUIVerticalText',
    SUBDIALOG: 'AUISubDialog',
    CONSOLE: 'AUIConsole',
    WINDOWPICTURE: 'AUIWindowPicture'
};

export function controllerName(file: string) {
    return 'CDlg' + (file.split(/[\\/]/).pop() ?? 'Interface').replace(/\.[^.]+$/, '').split(/[^a-zA-Z0-9]+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

const literal = (s: string) => JSON.stringify(s);

export function generateController(xml: string, name: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw Error('Invalid C++ class name');
    const doc = new DOMParser().parseFromString(xml.replace(/^[\s\uFEFF]+/, '').replace(/\u0000+$/, ''), 'application/xml');
    const root = Array.from(doc.getElementsByTagName('*')).find(element => element.tagName.toUpperCase() === 'DIALOG');
    if (doc.querySelector('parsererror') || !root) throw Error('Invalid interface XML');
    const used = new Set<string>(), commands = new Map<string, string>();
    const fields: { name: string; member: string; type: string }[] = [];
    const warnings: string[] = [];
    for (const e of Array.from(root.querySelectorAll('*'))) {
        const type = controls[e.tagName.toUpperCase()];
        if (!type) continue;
        const control = e.getAttribute('Name');
        if (!control) continue;
        if (fields.some(f => f.name === control)) throw Error('Duplicate control name: ' + control);
        let id = control.replace(/[^A-Za-z0-9_]/g, '_');
        if (!id) id = 'Control';
        let member = 'm_p' + id;
        let suffix = 2;
        while (used.has(member)) member = 'm_p' + id + suffix++;
        used.add(member);
        fields.push({name: control, member, type});
        if (e.tagName.toUpperCase() === 'STILLIMAGEBUTTON') {
            const command = e.getAttribute('Command') || control;
            if (!commands.has(command)) commands.set(command, 'OnCommand' + id + '_' + commands.size);
        }
    }
    const stem = name.startsWith('C') ? name.slice(1) : name;
    const header = ['#pragma once', '#include "DlgBase.h"', ...Array.from(new Set(fields.map(f => f.type))).sort().map(type => '#include "' + type + '.h"'), '', 'class ' + name + ' : public CDlgBase', '{', '    AUI_DECLARE_EVENT_MAP();', '    AUI_DECLARE_COMMAND_MAP();', '', 'public:', '    ' + name + '();', '', 'protected:', '    virtual bool OnInitDialog();', ...fields.map(f => '    ' + f.type + '* ' + f.member + ';'), '', ...Array.from(commands.values()).map(handler => '    void ' + handler + '(const char* szCommand);'), '};', ''].join('\n');
    const source = ['#include "' + stem + '.h"', '', 'AUI_BEGIN_COMMAND_MAP(' + name + ', CDlgBase)', ...Array.from(commands).map(([cmd, handler]) => '    AUI_ON_COMMAND(' + literal(cmd) + ', ' + handler + ')'), 'AUI_END_COMMAND_MAP()', '', 'AUI_BEGIN_EVENT_MAP(' + name + ', CDlgBase)', 'AUI_END_EVENT_MAP()', '', name + '::' + name + '()' + (fields.length ? ' : ' + fields.map(f => f.member + '(NULL)').join(', ') : ''), '{}', '', 'bool ' + name + '::OnInitDialog()', '{', '    if (!CDlgBase::OnInitDialog()) return false;', ...fields.map(f => '    DDX_Control(' + literal(f.name) + ', ' + f.member + ');'), '    return true;', '}', '', ...Array.from(commands.values()).flatMap(handler => ['void ' + name + '::' + handler + '(const char* szCommand)', '{', '    // TODO: implement command.', '}', ''])].join('\n');
    return {header, source, stem, warnings};
}
