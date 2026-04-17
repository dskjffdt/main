import React, { useEffect, useState } from "react";

function formatProveSuccess() {
  return "已生成本地证明，文件已写入您选择的文件夹。";
}

function formatVerifyResult(data) {
  if (data.ok) {
    return "在线核验通过。";
  }
  let text = "在线核验未通过。";
  if (data.hint?.note) {
    text += `\n${data.hint.note}`;
  } else if (data.publicSignals?.length >= 4) {
    text +=
      "\n请确认成绩与公示信息一致；若仍失败，请联系管理员。";
  }
  return text;
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [outDir, setOutDir] = useState("");

  const [min, setMin] = useState("60");
  const [max, setMax] = useState("100");
  const [subjectId, setSubjectId] = useState("101");
  const [grade, setGrade] = useState("85");
  const [studentCommit, setStudentCommit] = useState("8000000001");
  const [leafIndex, setLeafIndex] = useState("0");

  const [proveMsg, setProveMsg] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        setConfig(d);
        setOutDir((prev) => prev || d.defaultOutDir || "");
      })
      .catch(() => setConfig({ error: "无法连接服务，请确认本机应用已正常启动。" }));
  }, []);

  async function handleProve(e) {
    e.preventDefault();
    setProveMsg("");
    setLoading(true);
    try {
      const res = await fetch("/api/prove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min,
          max,
          subjectId,
          grade,
          studentCommit,
          leafIndex,
          outDir: outDir.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setProveMsg(formatProveSuccess());
    } catch (err) {
      setProveMsg(`操作未成功：${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setVerifyMsg("");
    setLoading(true);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outDir: outDir.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setVerifyMsg(formatVerifyResult(data));
    } catch (err) {
      setVerifyMsg(`操作未成功：${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  const chainReady = config?.chainVerifyReady === true;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">成绩区间隐私证明</h1>
        <p className="app__lead">填写本人成绩相关信息后，可在本机生成证明并申请在线核验。</p>
      </header>

      {config?.error && <p className="app__alert app__alert--error">{config.error}</p>}

      {config && !config.error && (
        <div
          className={`status-pill ${chainReady ? "status-pill--ok" : "status-pill--warn"}`}
          role="status"
        >
          <span className="status-pill__dot" aria-hidden />
          <span>{config.chainVerifyHint}</span>
        </div>
      )}

      <section className="card">
        <h2 className="card__title">保存位置</h2>
        <label className="field">
          <span className="field__label">文件夹</span>
          <p className="field__desc">请选择本机上的一个文件夹，用于保存生成的证明（需有写入权限）。</p>
          <input
            className="field__input"
            value={outDir}
            onChange={(e) => setOutDir(e.target.value)}
            placeholder={config?.defaultOutDir || "C:\\zk-snark-output"}
            autoComplete="off"
          />
        </label>
      </section>

      <form className="card" onSubmit={handleProve}>
        <h2 className="card__title">成绩与身份参数</h2>
        <div className="field-row">
          <label className="field">
            <span className="field__label">成绩下限</span>
            <input className="field__input" value={min} onChange={(e) => setMin(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">成绩上限</span>
            <input className="field__input" value={max} onChange={(e) => setMax(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field__label">科目编号</span>
            <input className="field__input" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">成绩</span>
            <input className="field__input" value={grade} onChange={(e) => setGrade(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">学生承诺（标识）</span>
          <input
            className="field__input"
            value={studentCommit}
            onChange={(e) => setStudentCommit(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">公示序号（0～{config?.maxLeaf ?? "524287"}）</span>
          <input className="field__input" value={leafIndex} onChange={(e) => setLeafIndex(e.target.value)} />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn btn--primary" disabled={loading}>
            {loading ? "处理中…" : "生成本地证明"}
          </button>
        </div>
        {proveMsg && <pre className="output output--prove section-gap">{proveMsg}</pre>}
      </form>

      <form className="card section-gap" onSubmit={handleVerify}>
        <h2 className="card__title">在线核验</h2>
        <p className="hint">将使用上方保存位置中的证明，向平台申请核验。</p>
        <div className="btn-row">
          <button type="submit" className="btn btn--secondary" disabled={loading || !chainReady}>
            提交核验
          </button>
        </div>
        {!chainReady && config && !config.error && (
          <p className="hint">该功能暂未向本机开放，请联系单位管理员。</p>
        )}
        {verifyMsg && <pre className="output output--verify section-gap">{verifyMsg}</pre>}
      </form>
    </div>
  );
}
