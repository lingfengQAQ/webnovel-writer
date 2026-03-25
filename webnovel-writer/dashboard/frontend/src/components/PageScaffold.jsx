const DESCRIPTION_STYLE = {
    marginTop: 0,
    marginBottom: 14,
    color: '#b5bdd2',
    fontSize: 13,
}

const CONTENT_STYLE = {
    display: 'grid',
    gap: 16,
}

export default function PageScaffold({ title, badge, description, children }) {
    return (
        <>
            <div className="page-header">
                <h2>{title}</h2>
                {badge ? <span className="card-badge badge-blue">{badge}</span> : null}
            </div>
            {description ? <p style={DESCRIPTION_STYLE}>{description}</p> : null}
            <div style={CONTENT_STYLE}>{children}</div>
        </>
    )
}
