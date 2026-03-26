import { Component } from 'react'

/**
 * P1-G 修复：全局错误边界组件
 *
 * 捕获子组件树中的 JavaScript 运行时错误，
 * 防止整个 App 因单个页面组件崩溃而白屏。
 * 展示友好的错误提示页面，并提供刷新操作。
 */
export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, errorInfo: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo })
        // 可在此接入监控系统，如 Sentry.captureException(error, { extra: errorInfo })
        console.error('[ErrorBoundary] 组件崩溃：', error, errorInfo)
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null })
    }

    render() {
        if (!this.state.hasError) {
            return this.props.children
        }

        const { error, errorInfo } = this.state
        const stackLines = errorInfo?.componentStack
            ?.split('\n')
            .filter(Boolean)
            .slice(0, 5)
            ?? []

        return (
            <div className="error-boundary" role="alert" aria-live="assertive">
                <div className="error-boundary__icon">⚠️</div>
                <h2 className="error-boundary__title">页面渲染出错</h2>
                <p className="error-boundary__message">
                    {(error?.message || null) ?? '发生未知错误'}
                </p>
                {stackLines.length > 0 && (
                    <details className="error-boundary__details">
                        <summary>技术信息</summary>
                        <pre>{stackLines.join('\n')}</pre>
                    </details>
                )}
                <div className="error-boundary__actions">
                    <button
                        className="error-boundary__btn"
                        onClick={this.handleReset}
                        type="button"
                    >
                        重试当前页面
                    </button>
                    <button
                        className="error-boundary__btn error-boundary__btn--secondary"
                        onClick={() => window.location.reload()}
                        type="button"
                    >
                        刷新整页
                    </button>
                </div>
            </div>
        )
    }
}
