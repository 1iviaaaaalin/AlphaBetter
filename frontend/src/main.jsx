from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import uuid

from utils import run_calc_stability, read_residue_scores, write_b_factor

app = FastAPI()

# CORS配置（开发环境）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路径配置
SCRIPT_PATH = Path("./calc_stability.py")
DI_DB = Path("./data/db_dipeptides.csv")
PENTA_DB = Path("./data/db_pentapeptides.csv")

UPLOAD_DIR = Path("./upload_temp")
OUTPUT_DIR = Path("./output")
TEMP_DIR = Path("./temp_out")

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

# 启动时校验核心文件
required_files = [SCRIPT_PATH, DI_DB, PENTA_DB]
for fpath in required_files:
    if not fpath.exists():
        raise RuntimeError(f"启动失败，缺失核心文件: {fpath.resolve()}")


@app.post("/upload")
async def upload_and_calc(file: UploadFile = File(...)):
    """
    上传PDB并计算稳定性
    返回JSON：残基伪势能列表 + 下载文件名，供前端MolStar自定义着色
    符合文献：前端不做计算，仅负责渲染
    """
    # 安全文件名，防御路径穿越
    suffix = Path(file.filename).suffix if file.filename else ".pdb"
    safe_name = f"{uuid.uuid4()}{suffix}"
    raw_pdb = UPLOAD_DIR / safe_name

    try:
        # 保存上传文件
        with open(raw_pdb, "wb") as f:
            shutil.copyfileobj(file.file, f)

        # 执行计算（本地USSA + 伪势能打分）
        score_csv = run_calc_stability(
            SCRIPT_PATH, raw_pdb, DI_DB, PENTA_DB, TEMP_DIR
        )
        score_map = read_residue_scores(score_csv)

        # 生成带原始伪势能B因子的PDB（供下载）
        out_pdb_name = f"colored_{safe_name}"
        out_pdb = OUTPUT_DIR / out_pdb_name
        write_b_factor(raw_pdb, out_pdb, score_map)

        # 组装前端所需的残基分数数组
        residue_list = []
        for (chain, resid), score in score_map.items():
            residue_list.append({
                "chain": chain,
                "resid": resid,
                "score": score
            })

        return {
            "ok": True,
            "download_filename": out_pdb_name,
            "residues": residue_list
        }

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"计算失败: {str(e)}")


@app.get("/download-pdb")
async def download_colored_pdb(filename: str):
    """下载带B因子的着色PDB文件"""
    out_pdb = OUTPUT_DIR / filename
    if not out_pdb.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(
        path=out_pdb,
        filename=filename,
        media_type="application/octet-stream"
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
