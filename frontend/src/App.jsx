import { useMemo, useRef, useState } from 'react';
import './App.css';

function getResidueScores(pdbText) {
  const residues = new Map();

  for (const line of pdbText.split(/\r?\n/)) {
    if (!line.startsWith('ATOM')) continue;

    const chain = line.slice(21, 22).trim();
    const resid = line.slice(22, 26).trim() + line.slice(26, 27).trim();
    const key = `${chain}:${resid}`;
    const value = Number.parseFloat(line.slice(60, 66).trim());

    if (Number.isFinite(value)) residues.set(key, value);
  }

  return [...residues.values()];
}

function App() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [pdbText, setPdbText] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [stats, setStats] = useState(null);
  const iframeRef = useRef(null);

  const residueScores = useMemo(() => getResidueScores(pdbText), [pdbText]);

  function chooseFile(nextFile) {
    setError('');
    setMessage('');
    setStats(null);
    setPdbText('');
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl('');

    if (!nextFile) {
      setFile(null);
      return;
    }

    if (!nextFile.name.toLowerCase().endsWith('.pdb')) {
      setFile(null);
      setError('请选择 .pdb 格式的蛋白质结构文件。');
      return;
    }

    setFile(nextFile);
  }

  async function handleUpload() {
    if (!file || loading) return;

    setLoading(true);
    setError('');
    setMessage('正在上传并计算稳定性，请稍候…');
    setPdbText('');
    setStats(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let detail = `服务器返回 ${response.status}`;
        try {
          const data = await response.json();
          if (data.detail) detail = data.detail;
        } catch {
          // 保留默认错误信息
        }
        throw new Error(detail);
      }

      const blob = await response.blob();
      const text = await blob.text();
      const url = URL.createObjectURL(new Blob([text], { type: 'chemical/x-pdb' }));
      setDownloadUrl(url);
      setPdbText(text);

      const scores = getResidueScores(text);
      const positive = scores.filter((v) => v > 0.05).length;
      const negative = scores.filter((v) => v < -0.05).length;
      const neutral = scores.length - positive - negative;
      const nonZero = scores.filter((v) => Math.abs(v) > 0.05);

      setStats({
        residues: scores.length,
        positive,
        negative,
        neutral,
        min: nonZero.length ? Math.min(...nonZero) : 0,
        max: nonZero.length ? Math.max(...nonZero) : 0,
      });
      setMessage('分析完成！下面可以直接查看 3D 结构。');
    } catch (err) {
      console.error(err);
      setError(err.message || '分析失败，请稍后重试。');
      setMessage('');
    } finally {
      setLoading(false);
    }
  }

  function sendPdbToViewer() {
    if (!pdbText || !iframeRef.current) return;
    const maxAbs = residueScores.reduce((m, value) => Math.max(m, Math.abs(value)), 0) || 1;
    iframeRef.current.contentWindow?.postMessage(
      { type: 'loadPDB', pdbText, maxAbs },
      window.location.origin,
    );
  }

  function handleViewerLoad() {
    sendPdbToViewer();
  }

  function handleDownload() {
    if (!downloadUrl) return;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `colored_${file?.name || 'protein.pdb'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <main className="page-shell">
      <header className="hero">
        <div className="brand-mark">AB</div>
        <div>
          <div className="eyebrow">PROTEIN STABILITY ANALYSIS</div>
          <h1>AlphaBetter</h1>
          <p>蛋白质结构稳定性分析与 3D 可视化平台</p>
        </div>
      </header>

      <section className="upload-card">
        <div className="section-title">
          <span className="step">01</span>
          <div>
            <h2>上传 PDB 文件</h2>
            <p>选择蛋白质结构文件，系统将在云端自动完成稳定性分析。</p>
          </div>
        </div>

        <label
          className={`drop-zone ${file ? 'has-file' : ''}`}
          htmlFor="pdb-input"
        >
          <input
            id="pdb-input"
            type="file"
            accept=".pdb"
            onChange={(event) => chooseFile(event.target.files?.[0] || null)}
          />
          <div className="upload-icon">↑</div>
          <strong>{file ? file.name : '点击选择 PDB 文件'}</strong>
          <span>{file ? '文件已准备好，可以开始分析' : '支持 .pdb 格式，单个文件不超过 20 MB'}</span>
        </label>

        <div className="actions">
          <button className="primary-button" onClick={handleUpload} disabled={!file || loading}>
            {loading ? '分析中…' : '开始分析'}
          </button>
          {downloadUrl && (
            <button className="secondary-button" onClick={handleDownload}>
              下载彩色 PDB
            </button>
          )}
        </div>

        {loading && (
          <div className="progress-line" aria-label="正在分析">
            <span />
          </div>
        )}

        {message && <div className="success-message">✓ {message}</div>}
        {error && <div className="error-message">{error}</div>}
      </section>

      {pdbText && (
        <section className="result-section">
          <div className="section-title result-heading">
            <span className="step">02</span>
            <div>
              <h2>稳定性结果</h2>
              <p>以稳定性评分进行 3D 着色：负值偏红、接近 0 为黄色、正值偏绿。</p>
            </div>
          </div>

          {stats && (
            <div className="stats-grid">
              <div className="stat-card">
                <span>残基数</span>
                <strong>{stats.residues}</strong>
              </div>
              <div className="stat-card green">
                <span>稳定区域</span>
                <strong>{stats.positive}</strong>
              </div>
              <div className="stat-card red">
                <span>不稳定区域</span>
                <strong>{stats.negative}</strong>
              </div>
              <div className="stat-card yellow">
                <span>中性区域</span>
                <strong>{stats.neutral}</strong>
              </div>
            </div>
          )}

          <div className="viewer-card">
            <div className="viewer-toolbar">
              <div className="legend">
                <span><i className="dot red-dot" />不稳定</span>
                <span><i className="dot yellow-dot" />中性</span>
                <span><i className="dot green-dot" />稳定</span>
              </div>
              <span className="viewer-tip">鼠标拖动旋转 · 滚轮缩放</span>
            </div>
            <iframe
              ref={iframeRef}
              title="Protein 3D Viewer"
              src="/viewer.html"
              onLoad={handleViewerLoad}
            />
          </div>

          <div className="score-note">
            <span>评分范围</span>
            <strong>{stats ? `${stats.min.toFixed(2)} ～ ${stats.max.toFixed(2)}` : '—'}</strong>
          </div>
        </section>
      )}

      <footer>AlphaBetter · Protein Stability Analysis & Visualization</footer>
    </main>
  );
}

export default App;
