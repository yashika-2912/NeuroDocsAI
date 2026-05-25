import React, { useState } from "react";
import { BookOpen, Eye, EyeOff, Mail, Lock } from "lucide-react";
import { API_BASE } from "./api";

/**
 * Shared auth form for login and registration.
 * mode: "login" | "register"
 */
export default function AuthForm({ mode, onSuccess, onSwitch }) {
    const isLogin = mode === "login";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError("");
        setLoading(true);
        const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            if (!response.ok) throw new Error(await response.text());
            onSuccess(await response.json());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    function handleGoogleAuth() {
        window.location.href = `${API_BASE}/api/auth/google`;
    }

    return (
        <div className="auth-page">
            <div className="auth-orb auth-orb-1" aria-hidden="true" />
            <div className="auth-orb auth-orb-2" aria-hidden="true" />
            <div className="auth-orb auth-orb-3" aria-hidden="true" />

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
                    <h2>{isLogin ? "Welcome back" : "Create account"}</h2>
                    <p>
                        {isLogin
                            ? "Sign in to continue to your workspace"
                            : "Start exploring your documents with AI"}
                    </p>
                </div>

                <button className="google-btn" type="button" onClick={handleGoogleAuth}>
                    <GoogleIcon />
                    Continue with Google
                </button>

                <div className="auth-divider">
                    <span>{isLogin ? "or sign in with email" : "or register with email"}</span>
                </div>

                <form onSubmit={handleSubmit} className="auth-fields">
                    <div className="auth-input-wrap">
                        <Mail size={17} className="auth-input-icon" aria-hidden="true" />
                        <input
                            id="auth-email"
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            aria-label="Email address"
                        />
                    </div>
                    <div className="auth-input-wrap">
                        <Lock size={17} className="auth-input-icon" aria-hidden="true" />
                        <input
                            id="auth-password"
                            type={showPassword ? "text" : "password"}
                            placeholder={isLogin ? "Password" : "Create a password"}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete={isLogin ? "current-password" : "new-password"}
                            aria-label="Password"
                        />
                        <button
                            type="button"
                            className="auth-eye-btn"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>

                    {error && (
                        <div className="auth-error" role="alert">
                            {error}
                        </div>
                    )}

                    <button type="submit" className="auth-submit-btn" disabled={loading}>
                        {loading && <span className="auth-spinner" aria-hidden="true" />}
                        {loading
                            ? isLogin
                                ? "Signing in..."
                                : "Creating account..."
                            : isLogin
                                ? "Sign In"
                                : "Create Account"}
                    </button>
                </form>

                <p className="auth-switch">
                    {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
                    <button type="button" onClick={onSwitch}>
                        {isLogin ? "Create one" : "Sign in"}
                    </button>
                </p>
            </div>
        </div>
    );
}

function GoogleIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
        </svg>
    );
}
