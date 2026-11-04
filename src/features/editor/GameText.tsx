const colorCode = /\^([0-9a-f]{6})/gi;

export function plainGameText(text: string) {
    return text.replace(colorCode, '');
}

export function GameText({text}: { text: string }) {
    let start = 0;
    let color: string | undefined;
    const spans = [];
    for (const match of text.matchAll(colorCode)) {
        const end = match.index;
        if (end > start) spans.push(<span key={start} style={{color}}>{text.slice(start, end)}</span>);
        color = `#${match[1]}`;
        start = end + match[0].length;
    }
    if (start === 0) return <>{text}</>;
    if (start < text.length) spans.push(<span key={start} style={{color}}>{text.slice(start)}</span>);
    return <>{spans}</>;
}
