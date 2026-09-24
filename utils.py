import subprocess
import csv
from pathlib import Path


def run_calc_stability(
    script_path: Path,
    pdb_path: Path,
    di_db: Path,
    penta_db: Path,
    out_dir: Path
) -> Path:
    """
    调用本地calc_stability.py计算伪势能
    符合文献：本地复现USSA算法 + 二肽/五肽打分，不依赖外部在线服务
    """
    out_dir.mkdir(exist_ok=True)
    cmd = [
        "python", str(script_path),
        "--pdb", str(pdb_path),
        "--di", str(di_db),
        "--penta", str(penta_db),
        "--out", str(out_dir),
    ]
    result = subprocess.run(
        cmd,
        cwd=script_path.parent,
        capture_output=True,
        encoding="utf-8",
        timeout=120
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"稳定性计算脚本执行失败\n"
            f"STDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
    score_csv = out_dir / "residue_scores.csv"
    if not score_csv.exists():
        raise FileNotFoundError(f"未生成残基分数文件: {score_csv}")
    return score_csv


def read_residue_scores(csv_path: Path):
    """读取残基伪势能csv，构建(chain, resid)→score映射"""
    res_score_map = {}
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        required_cols = {"chain", "resid", "score"}
        missing = required_cols - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"分数CSV缺少必要字段: {sorted(missing)}")

        for row in reader:
            chain = row["chain"].strip()
            resid = row["resid"].strip()
            if not resid:
                continue
            try:
                score = float(row["score"])
            except ValueError as e:
                raise ValueError(f"分数解析失败 chain={chain}, resid={resid}: {e}")
            res_score_map[(chain, resid)] = score
    return res_score_map


def write_b_factor(input_pdb_path: Path, output_pdb_path: Path, res_score_map):
    """
    将原始伪势能写入PDB的B因子列
    严格符合文献1.5：计算得到的能量分布图直接转换为B因子值，不做归一化缩放
    仅做±99.99格式钳位，防止PDB固定宽度字段溢出
    """
    match_count = 0
    B_CLAMP_MIN = -99.99
    B_CLAMP_MAX = 99.99

    with open(input_pdb_path, "r", encoding="utf-8") as f_in, \
         open(output_pdb_path, "w", encoding="utf-8") as f_out:
        for line in f_in:
            if line.startswith("ATOM"):
                chain_id = line[21].strip()
                res_seq = line[22:26].strip()
                icode = line[26:27].strip()
                resid = f"{res_seq}{icode}".strip()

                raw_score = res_score_map.get((chain_id, resid), 0.0)
                if (chain_id, resid) in res_score_map:
                    match_count += 1
                    if match_count <= 5:
                        print(f"[调试] 残基{resid} 原始伪势能:{raw_score:.2f}")

                # 仅格式安全钳位，不做任何线性缩放，B因子 = 原始伪势能
                b_factor = max(B_CLAMP_MIN, min(B_CLAMP_MAX, raw_score))
                new_b = f"{b_factor:6.2f}"
                new_line = line[:60] + new_b + line[66:]
                f_out.write(new_line)
            else:
                f_out.write(line)

    print(f"[调试] 总匹配残基数: {match_count}")
    return match_count
