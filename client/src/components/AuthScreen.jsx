import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';

function Field({ label, type = 'text', value, onChange, autoComplete, autoFocus, hint }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input type={type} value={value} autoComplete={autoComplete} autoFocus={autoFocus} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Sign-in, sign-up and first-run setup. */
export function AuthScreen() {
  const auth = useStore((s) => s.auth);
  const st = useStore.getState();
  const [mode, setMode] = useState(auth.phase === 'setup' ? 'setup' : 'login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(auth.error || null);
  useEffect(() => { setError(auth.error || null); }, [auth.error]);

  if (auth.phase === 'loading') {
    return <div className="auth-wrap"><div className="auth-card"><div className="spinner" /></div></div>;
  }
  if (auth.phase === 'offline') {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <Brand />
          <p className="auth-error">连不上 GreanTeaDawy 服务端（{auth.error}）。正在重试…</p>
          <p className="muted">Make sure it is running: <code>npm start</code> 或 <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }

  const isSetup = auth.phase === 'setup';
  const current = isSetup ? 'setup' : mode;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if ((current === 'setup' || current === 'register') && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      if (current === 'setup') await st.setupAdmin({ username, password, displayName, setupCode });
      else if (current === 'register') await st.signUp({ username, password, displayName });
      else await st.signIn({ username, password });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} onKeyDown={(e) => e.stopPropagation()}>
        <Brand />
        {current === 'setup' && (
          <>
            <h2>欢迎！创建管理员账号</h2>
            <p className="muted">第一个账号用来管理这个工作室：用户、注册与 MCP 访问。你的工程只属于你自己的账号。</p>
          </>
        )}
        {current === 'login' && <h2>登录你的工作室</h2>}
        {current === 'register' && <h2>创建你的账号</h2>}
        {current === 'setup' && auth.setupCodeRequired && (
          <Field label="初始化码" value={setupCode} onChange={setSetupCode} autoComplete="one-time-code" autoFocus
            hint="服务端启动时会打印在日志里 — 用来证明你是这台服务器的所有者。" />
        )}
        {(current === 'setup' || current === 'register') && (
          <Field label="显示名" value={displayName} onChange={setDisplayName} autoComplete="name" autoFocus={!auth.setupCodeRequired} />
        )}
        <Field label="用户名" value={username} onChange={setUsername} autoComplete="username" autoFocus={current === 'login'}
          hint={current !== 'login' ? '3–32 个字符：字母、数字、_ . -' : undefined} />
        <Field label="密码" type="password" value={password} onChange={setPassword}
          autoComplete={current === 'login' ? 'current-password' : 'new-password'} hint={current !== 'login' ? '至少 8 个字符' : undefined} />
        {(current === 'setup' || current === 'register') && (
          <Field label="确认密码" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="btn primary auth-submit" type="submit" disabled={busy || !username || !password}>
          {busy ? '请稍候…' : current === 'setup' ? '创建管理员并进入工作台' : current === 'register' ? '创建账号' : '登录'}
        </button>
        {!isSetup && auth.allowRegistration && (
          <p className="auth-switch">
            {mode === 'login'
              ? <>第一次来？ <button type="button" className="link" onClick={() => { setMode('register'); setError(null); }}>创建账号</button></>
              : <>已有账号？ <button type="button" className="link" onClick={() => { setMode('login'); setError(null); }}>登录</button></>}
          </p>
        )}
        {!isSetup && !auth.allowRegistration && <p className="auth-switch muted">需要账号？请联系你的工作室管理员。</p>}
      </form>
    </div>
  );
}

function Brand() {
  return (
    <div className="auth-brand">
      <span className="logo-mark">◆</span>
      <div>
        <div className="auth-title">GreanTeaDawy</div>
        <div className="auth-sub">在浏览器里做音乐——Claude 与你共同制作</div>
      </div>
    </div>
  );
}
