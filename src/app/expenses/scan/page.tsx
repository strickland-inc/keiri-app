"use client";

import React, { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { isExpenseCategory } from "@/domain/expense";
import { createExpense } from "../actions";
import {
  BackButton,
  ConfirmSheet,
  FileAnalyzingOverlay,
  GuideOverlay,
  ScanError,
  StatusPill,
  Toast,
  type ConfirmData,
} from "./scan-views";

type ScanStatus = "init" | "scanning" | "analyzing" | "confirm" | "error";
type ErrorType = "permission" | "other";

interface ScanResult {
  found: boolean;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  confidence: number;
}

const MIN_INTERVAL_MS = 2500;
const LONG_INTERVAL_MS = 5000;
const PIXEL_SAMPLES = 64;
const STILL_THRESHOLD = 8;

export default function ScanPage(): React.ReactElement {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<ScanStatus>("init");

  // スキャンループの状態は ref に置く（クロージャが古くならないように）
  const lastPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const lastSentAtRef = useRef<number>(0);
  const inFlightRef = useRef(false);
  const lastAmountRef = useRef<number | null>(null);
  const notFoundCountRef = useRef(0);

  const [status, setStatusState] = useState<ScanStatus>("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ErrorType | null>(null);
  // 確認シートで編集中の値（null の間はシートを出さない）
  const [confirmData, setConfirmData] = useState<ConfirmData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  const setStatus = (s: ScanStatus) => {
    statusRef.current = s;
    setStatusState(s);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // 読み取り結果を確認シートに出す。カメラ/ファイル両方から使う
  const openConfirm = (data: ScanResult, amount: number) => {
    const category = isExpenseCategory(data.category)
      ? data.category
      : "要確認";
    setConfirmData({
      date: data.date,
      merchant: data.merchant,
      amount,
      category,
    });
    setStatus("confirm");
  };

  // スキャンループ。毎レンダーで差し替え、常に最新の state を参照させる
  const loopFnRef = useRef<() => void>(() => {});
  useEffect(() => {
    loopFnRef.current = () => {
      const s = statusRef.current;
      if (s === "init" || s === "confirm" || s === "error") return;
      if (inFlightRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);

      // 動き検出のため画素を間引いて取る
      const { width: w, height: h } = canvas;
      const imageData = ctx.getImageData(0, 0, w, h);
      const pixels = imageData.data;
      const samples = new Uint8ClampedArray(PIXEL_SAMPLES * PIXEL_SAMPLES);
      for (let i = 0; i < PIXEL_SAMPLES; i++) {
        for (let j = 0; j < PIXEL_SAMPLES; j++) {
          const px = Math.floor((j / PIXEL_SAMPLES) * w);
          const py = Math.floor((i / PIXEL_SAMPLES) * h);
          const idx = (py * w + px) * 4;
          samples[i * PIXEL_SAMPLES + j] = Math.round(
            0.299 * pixels[idx] +
              0.587 * pixels[idx + 1] +
              0.114 * pixels[idx + 2],
          );
        }
      }

      // 静止しているか確認
      const prev = lastPixelsRef.current;
      if (prev && prev.length === samples.length) {
        let diff = 0;
        for (let k = 0; k < samples.length; k++)
          diff += Math.abs(samples[k] - prev[k]);
        if (diff / samples.length >= STILL_THRESHOLD) {
          lastPixelsRef.current = samples;
          return; // 動いている間は送らない
        }
      }
      lastPixelsRef.current = samples;

      // 送信間隔を空ける
      const now = Date.now();
      const minGap =
        notFoundCountRef.current >= 2 ? LONG_INTERVAL_MS : MIN_INTERVAL_MS;
      if (now - lastSentAtRef.current < minGap) return;

      // 撮影して送信
      inFlightRef.current = true;
      lastSentAtRef.current = now;
      statusRef.current = "analyzing";
      setStatusState("analyzing");

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      fetch("/api/expenses/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      })
        .then((r) => r.json() as Promise<ScanResult>)
        .then((data) => {
          if (!mountedRef.current) return;
          if (!data.found) {
            notFoundCountRef.current += 1;
            lastAmountRef.current = null;
            setStatus("scanning");
            return;
          }
          notFoundCountRef.current = 0;
          const amount = Math.round(data.amount);
          if (amount > 0 && lastAmountRef.current === amount) {
            // 同じ金額が 2 回続けて読めたら確認シートを出す
            openConfirm(data, amount);
          } else {
            lastAmountRef.current = amount;
            setStatus("scanning");
          }
        })
        .catch(() => {
          if (mountedRef.current) setStatus("scanning");
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };
  });

  // カメラの起動と後片付け
  useEffect(() => {
    mountedRef.current = true;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg(
          "このブラウザはカメラに対応していません（HTTPS 接続が必要です）",
        );
        setErrorType("other");
        setStatus("error");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (mountedRef.current) setStatus("scanning");
      } catch (e: unknown) {
        if (!mountedRef.current) return;
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setErrorMsg(
            "カメラへのアクセスが拒否されました。画像を選択して登録することもできます。",
          );
          setErrorType("permission");
        } else {
          setErrorMsg("カメラを起動できませんでした。");
          setErrorType("other");
        }
        setStatus("error");
      }
    };

    start();

    return () => {
      mountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ループ自体は固定の間隔で回し、中身は loopFnRef 経由で最新にする
  useEffect(() => {
    const id = setInterval(() => loopFnRef.current(), 500);
    return () => clearInterval(id);
  }, []);

  // カメラが使えないときの画像ファイル取り込み
  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 同じファイルを続けて選べるよう値を戻す
    e.target.value = "";

    setStatus("analyzing");

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") {
        showToast("ファイルを読み込めませんでした");
        setStatus("error");
        return;
      }
      try {
        const response = await fetch("/api/expenses/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        const data = await (response.json() as Promise<ScanResult>);
        if (!mountedRef.current) return;
        if (!data.found || data.amount <= 0) {
          showToast("領収書が検出できませんでした");
          setStatus("error");
          return;
        }
        openConfirm(data, Math.round(data.amount));
      } catch {
        if (mountedRef.current) {
          showToast("解析に失敗しました");
          setStatus("error");
        }
      }
    };
    reader.onerror = () => {
      showToast("ファイルを読み込めませんでした");
      setStatus("error");
    };
    reader.readAsDataURL(file);
  };

  const handleRegister = async (): Promise<void> => {
    if (!confirmData) return;
    const amount = Math.round(confirmData.amount);
    if (!amount || amount <= 0) {
      showToast("金額を入力してください");
      return;
    }
    setIsRegistering(true);
    try {
      await createExpense({
        date: confirmData.date,
        merchant: confirmData.merchant,
        amount,
        category: confirmData.category,
      });
      showToast("登録しました");
      resumeAfterConfirm();
    } catch {
      showToast("登録に失敗しました");
    } finally {
      setIsRegistering(false);
    }
  };

  // 確認シートを閉じた後の戻り先。ファイル取り込み中は選択画面、カメラ中はスキャン再開
  const resumeAfterConfirm = (): void => {
    setConfirmData(null);
    lastAmountRef.current = null;
    notFoundCountRef.current = 0;
    setStatus(errorType === "permission" ? "error" : "scanning");
  };

  const statusMessages: Record<ScanStatus, string> = {
    init: "カメラを起動しています...",
    scanning: "スキャン中",
    analyzing: "読み取り中...",
    confirm: "確認",
    error: errorMsg ?? "エラーが発生しました",
  };

  const isFileMode = errorType === "permission";
  const goBack = () => router.push("/expenses");

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* フレーム取得用（非表示） */}
      <canvas ref={canvasRef} className="hidden" />

      {(status === "scanning" || (status === "analyzing" && !isFileMode)) && (
        <GuideOverlay />
      )}

      {status !== "confirm" && status !== "error" && !isFileMode && (
        <StatusPill
          message={statusMessages[status]}
          busy={status === "analyzing"}
        />
      )}

      {status === "analyzing" && isFileMode && <FileAnalyzingOverlay />}

      {status === "error" && (
        <ScanError
          message={errorMsg ?? ""}
          canPickFile={isFileMode}
          fileInputRef={fileInputRef}
          onFileSelect={handleFileSelect}
          onBack={goBack}
        />
      )}

      {status === "confirm" && confirmData && (
        <ConfirmSheet
          values={confirmData}
          onChange={setConfirmData}
          onRegister={handleRegister}
          onDiscard={resumeAfterConfirm}
          isRegistering={isRegistering}
        />
      )}

      <BackButton onClick={goBack} />
      {toast && <Toast message={toast} />}
    </div>
  );
}
