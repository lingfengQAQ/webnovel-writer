const TONE_CLASS = {
    blue: 'badge-blue',
    green: 'badge-green',
    amber: 'badge-amber',
    red: 'badge-red',
    purple: 'badge-purple',
    cyan: 'badge-cyan',
    neutral: 'badge-neutral',
}

export default function Badge({ tone = 'neutral', className = '', title = '', children }) {
    const toneClass = TONE_CLASS[tone] || TONE_CLASS.neutral
    return (
        <span className={`badge ${toneClass} ${className}`.trim()} title={title}>
            {children}
        </span>
    )
}
