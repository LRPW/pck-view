import {useEffect, useRef, useState} from 'react';
import {MediaPreview, mediaType} from '../media/MediaPreview';

export const isImageResource = (path: string) => mediaType(path).startsWith('image/');
export const isImageField = (field: string) => /(?:^|[. _])(?:icon\d*|img|tex|texture|skin)(?:$|[. _])/i.test(field);

export function ResourceFieldPreview({path, read}: {
    path: string;
    read: (path: string) => Promise<number[]>;
}) {
    const target = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    const [image, setImage] = useState<{ path: string; bytes: number[] }>();

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
        if (target.current) observer.observe(target.current);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!visible || image?.path === path) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void read(path).then(bytes => {
                if (!cancelled) setImage({path, bytes});
            }).catch(() => {
            });
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [visible, path, read, image?.path]);

    return <div className="resource-thumbnail" ref={target}>
        {image?.path === path && <MediaPreview name={path} bytes={image.bytes} thumbnail/>}
    </div>;
}
