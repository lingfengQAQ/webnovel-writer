function IconBase({ children, className = '' }) {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className={`pixel-icon ${className}`.trim()}
            fill="currentColor"
            shapeRendering="crispEdges"
        >
            {children}
        </svg>
    )
}

export function ChartBarIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="3" y="13" width="4" height="8" />
            <rect x="10" y="9" width="4" height="12" />
            <rect x="17" y="5" width="4" height="16" />
            <rect x="3" y="3" width="18" height="2" />
        </IconBase>
    )
}

export function UsersIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="5" y="5" width="5" height="5" />
            <rect x="14" y="6" width="5" height="4" />
            <rect x="4" y="13" width="7" height="6" />
            <rect x="13" y="13" width="7" height="6" />
        </IconBase>
    )
}

export function TrendingUpIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="3" y="17" width="4" height="4" />
            <rect x="8" y="13" width="4" height="4" />
            <rect x="13" y="9" width="4" height="4" />
            <rect x="18" y="4" width="3" height="3" />
            <rect x="17" y="4" width="2" height="11" transform="rotate(45 18 9.5)" />
        </IconBase>
    )
}

export function BookmarkIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="5" y="3" width="14" height="18" />
            <rect x="8" y="14" width="8" height="4" transform="rotate(45 12 16)" />
        </IconBase>
    )
}

export function FolderIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="2" y="7" width="20" height="12" />
            <rect x="2" y="5" width="8" height="3" />
        </IconBase>
    )
}

export function SlidersIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="4" y="4" width="2" height="16" />
            <rect x="11" y="4" width="2" height="16" />
            <rect x="18" y="4" width="2" height="16" />
            <rect x="2" y="8" width="6" height="3" />
            <rect x="9" y="14" width="6" height="3" />
            <rect x="16" y="9" width="6" height="3" />
        </IconBase>
    )
}

export function PlayIcon(props) {
    return (
        <IconBase {...props}>
            <polygon points="7,5 19,12 7,19" />
        </IconBase>
    )
}

export function PauseIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
        </IconBase>
    )
}

export function ChevronLeftIcon(props) {
    return (
        <IconBase {...props}>
            <polygon points="15,5 7,12 15,19 15,15 11,12 15,9" />
        </IconBase>
    )
}

export function ChevronRightIcon(props) {
    return (
        <IconBase {...props}>
            <polygon points="9,5 17,12 9,19 9,15 13,12 9,9" />
        </IconBase>
    )
}

export function ChevronsRightIcon(props) {
    return (
        <IconBase {...props}>
            <polygon points="5,5 13,12 5,19 5,15 9,12 5,9" />
            <polygon points="11,5 19,12 11,19 11,15 15,12 11,9" />
        </IconBase>
    )
}

export function ReloadIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="5" y="5" width="10" height="2" />
            <rect x="5" y="5" width="2" height="10" />
            <rect x="9" y="17" width="10" height="2" />
            <rect x="17" y="9" width="2" height="10" />
            <polygon points="15,3 21,6 15,9" />
            <polygon points="9,15 3,18 9,21" />
        </IconBase>
    )
}

export function WifiIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="11" y="17" width="2" height="2" />
            <rect x="8" y="14" width="8" height="2" />
            <rect x="5" y="11" width="14" height="2" />
            <rect x="2" y="8" width="20" height="2" />
        </IconBase>
    )
}

export function WifiOffIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="11" y="17" width="2" height="2" />
            <rect x="8" y="14" width="8" height="2" />
            <rect x="5" y="11" width="14" height="2" />
            <rect x="2" y="8" width="20" height="2" />
            <rect x="4" y="4" width="2" height="16" transform="rotate(-45 5 12)" />
        </IconBase>
    )
}

export function SearchIcon(props) {
    return (
        <IconBase {...props}>
            <rect x="5" y="5" width="9" height="9" />
            <rect x="13" y="13" width="7" height="2" transform="rotate(45 16.5 14)" />
        </IconBase>
    )
}
