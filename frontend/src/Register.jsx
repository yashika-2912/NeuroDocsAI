import React, { useState } from "react";
import { BookOpen, Eye, EyeOff, Mail, Lock } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export default function Register({ onRegister, switchToLogin }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const response = await fetch(`${API_BASE}/api/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            if (!response.ok) throw new Error(await response.text());
            const data = await response.json();
            onRegister(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleLogin() {
        window.location.href = `${API_BASE}/api/auth/google`;
    }

    return (
        <div className="auth-page">
            <div className="auth-orb auth-orb-1" />
            <div className="auth-orb auth-orb-2" />
            <div className="auth-orb auth-orb-3" />

            <div className="auth-float-card">
                <div className="auth-logo">
                    <div className="auth-logo-mark">
                        <BookOpen size={26} />
                    </div>
                    <div>
                        <strong>NeuroDocs AI</strong>
                        <span>Intelligent Document Assistant</span>
                    </div>
                </div>

                <div className="auth-header">
                    <h2>Create account</h2>
                    <p>Start exploring your documents with AI</p>
                </div>

                <button className="google-btn" type="button" onClick={handleGoogleLogin}>
                    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                        <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                    Continue with Google
                </button>

                <div className="auth-divider">
                    <span>or register with email</span>
                </div>

                <form onSubmit={handleSubmit} className="auth-fields">
                    <div className="auth-input-wrap">
                        <Mail size={17} className="auth-input-icon" />
                        <input
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                        />
                    </div>
                    <div className="auth-input-wrap">
                        <Lock size={17} className="auth-input-icon" />
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="Create a password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            className="auth-eye-btn"
                            onClick={() => setShowPassword(v => !v)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>

                    {error && <div className="auth-error" role="alert">{error}</div>}

                    <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading ? <span className="auth-spinner" /> : null}
                        {loading ? "Creating account..." : "Create Account"}
                    </button>
                </form>

                <p className="auth-switch">
                    Already have an account?{" "}
                    <button type="button" onClick={switchToLogin}>Sign in</button>
                </p>
            </div>
        </div>
    );
}
