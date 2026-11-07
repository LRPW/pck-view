// Native DTF layouts. Token order follows AUInterface::*::Init/Save.
export type DtfLayout = {
    attributes: Record<string, number>;
    resources: Record<string, number>;
    font?: number;
    text?: number;
    size?: number;
    defaults: string[]
};
const common = {Name: 1, Command: 2, SoundEffect: 3, x: 4, y: 5, Width: 6, Height: 7};
export const DTF_TYPES = ['LABEL', 'STILLIMAGEBUTTON', 'IMAGEPICTURE', 'CHECK', 'RADIO', 'EDIT', 'LIST', 'COMBO', 'TREE', 'PROGRESS', 'SLIDER', 'SCROLL', 'CONSOLE', 'WINDOWPICTURE', 'TEXT', 'SUBDIALOG'];

export function dtfLayout(type: string, version: number, rowLength?: number): DtfLayout {
    const attributes: Record<string, number> = {...common};
    const resources: Record<string, number> = {};
    let extra: string[] = [];
    let font: number | undefined, text: number | undefined, size: number | undefined;
    const values = (v: string) => v.match(/"[^"]*"|\S+/g) ?? [];
    switch (type) {
        case 'DIALOG':
            return {
                attributes: {
                    Name: 1,
                    x: 2,
                    y: 3,
                    Width: 4,
                    Height: 5,
                    TitleX: 12,
                    TitleY: 13,
                    TitleWidth: 14,
                    TitleHeight: 15,
                    CloseX: 17,
                    CloseY: 18,
                    Alpha: 22,
                    DefaultVisible: 23
                },
                resources: {FrameImage: 9, BackgroundImage: 10, TitleImage: 11, CloseButtonImage: 16},
                font: 7,
                text: 6,
                size: 8,
                defaults: values('DIALOG "Dialog" 0 0 800 600 0 0 12 "" "" "" 0 0 0 0 "" 0 0 255 255 255 255 1')
            };
        case 'LABEL':
            font = 8;
            size = 9;
            text = 10;
            extra = values('0 12 0 255 255 255 255');
            break;
        case 'STILLIMAGEBUTTON':
            font = 12;
            size = 13;
            resources.FrameUpImage = 18;
            resources.FrameDownImage = 19;
            let i = 20;
            if (version >= 4) resources.FrameOnHoverImage = i++;
            if (version > 1) resources.FrameDisabledImage = i++;
            text = i++;
            attributes.Align = i++;
            if (version > 0) attributes.FrameMode = i;
            extra = values('0 0 0 0 0 12 255 255 255 255');
            extra.push(...Array(i - 18).fill('""'));
            extra[text - 8] = '0';
            extra[attributes.Align - 8] = '1';
            if (version > 0) extra[attributes.FrameMode - 8] = '0';
            break;
        case 'IMAGEPICTURE':
            attributes.NumFrames = 8;
            attributes.FrameInterval = 9;
            resources.FrameImage = 10;
            if (version >= 3) resources.Gfx = 11;
            extra = values('1 0 ""' + (version >= 3 ? ' ""' : ''));
            break;
        case 'CHECK':
            resources.NormalImage = 8;
            extra = ['""'];
            break;
        case 'RADIO':
            resources.NormalImage = 8;
            attributes.ButtonID = 9;
            attributes.GroupID = 10;
            extra = values('"" 0 0');
            break;
        case 'PROGRESS':
            resources.FrameImage = 8;
            resources.BarImage = 9;
            Object.assign(attributes, {
                FillMarginLeft: 10,
                FillMarginTop: 11,
                FillMarginRight: 12,
                FillMarginBottom: 13
            });
            if (version > 0) attributes.FrameMode = 14;
            extra = values('"" "" 0 0 0 0' + (version > 0 ? ' 0' : ''));
            break;
        case 'SLIDER':
            resources.FrameImage = 8;
            resources.SliderImage = 9;
            attributes.TotalLevels = 10;
            if (version > 0) attributes.FrameMode = 11;
            extra = values('"" "" 100' + (version > 0 ? ' 0' : ''));
            break;
        case 'SCROLL':
            resources.ScrollImage = 8;
            resources.UpImage = 9;
            resources.DownImage = 10;
            resources.BarImage = 11;
            if (version > 0) attributes.FrameMode = 12;
            extra = values('"" "" "" ""' + (version > 0 ? ' 0' : ''));
            break;
        case 'TEXT':
        case 'LIST':
        case 'TREE':
        case 'COMBO': {
            font = 8;
            size = 9;
            extra = values('0 12 255 255 255 255');
            const names = type === 'TEXT' ? ['FrameImage', 'UpImage', 'DownImage', 'ScrollImage', 'BarImage'] : type === 'LIST' ? ['FrameImage', 'HilightImage', 'UpImage', 'DownImage', 'VScrollImage', 'VBarImage', 'LeftImage', 'RightImage', 'HScrollImage', 'HBarImage'] : type === 'TREE' ? ['FrameImage', 'HilightImage', 'UpImage', 'DownImage', 'LeftImage', 'RightImage', 'HScrollImage', 'VScrollImage', 'HBarImage', 'VBarImage', 'PlusImage', 'MinusImage', 'LeafImage', 'LeafCheckImage'] : ['FrameImage', 'HilightImage'];
            if (type === 'LIST' && (rowLength === 22 || rowLength === 23 || rowLength === undefined && version === 0)) names.splice(6);
            names.forEach((name, index) => resources[name] = 14 + index);
            extra.push(...names.map(() => '""'));
            let i = 14 + names.length;
            if (type === 'LIST') {
                attributes.MultiSel = i++;
                attributes.Columns = i++;
                extra.push('0', '"0"');
            }
            if (version > 0) {
                attributes.FrameMode = i;
                extra.push('0');
            }
            break;
        }
        case 'EDIT': {
            resources.FrameImage = 8;
            font = 9;
            size = 10;
            attributes.Password = 14;
            attributes.ReadOnly = 15;
            attributes.Multiline = 16;
            attributes.MaxLen = 17;
            extra = values('"" 0 12 255 255 255 "TEXT" 0 0 512');
            let i = 18;
            if (version > 0) {
                attributes.FrameMode = i++;
                extra.push('0');
            }
            if (version >= 5) for (const name of ['UpImage', 'DownImage', 'ScrollImage', 'BarImage']) {
                resources[name] = i++;
                extra.push('""');
            }
            break;
        }
        case 'CONSOLE':
            font = 8;
            size = 9;
            extra = values('0 12');
            break;
        case 'WINDOWPICTURE':
        case 'SUBDIALOG':
            break;
        default:
            throw Error('DTF layout requires version-specific support: ' + type);
    }
    return {
        attributes,
        resources,
        font,
        text,
        size,
        defaults: [type, '"Control"', '""', '""', '0', '0', '120', '28', ...extra]
    };
}
