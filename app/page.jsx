"use client";
/* eslint-disable */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, FileAudio, Play, Pause, 
  Loader2, Download,
  Mic, MessageSquare, ImagePlus, Scissors, ArrowUp, Eye, Image as ImageIcon, Video,
  ToggleLeft, ToggleRight
} from 'lucide-react';

// ================= 图片丝滑渐变组件 =================
const CrossfadeImage = ({ src }) => {
  const [images, setImages] = useState([src]);

  useEffect(() => {
    if (src && src !== images[images.length - 1]) {
      setImages((prev) => [...prev.slice(-1), src]);
    }
  }, [src]);

  return (
    <div className="relative w-full h-full flex-shrink-0 overflow-hidden bg-black">
      {images.map((imgSrc, idx) => (
        <img
          key={`${imgSrc}-${idx}`}
          src={imgSrc}
          alt="Visual Context"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-in-out ${
            idx === images.length - 1 ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
};

// ================= 核心：原稿段落严格映射算法 =================
const getParagraphBreaks = (allWords, rawText) => {
    const breaks = new Set();
    if (!rawText) return breaks;

    let textTracker = rawText.toLowerCase().replace(/[^a-z0-9\n]/g, '');
    let currentSearchPos = 0;

    for (let i = 0; i < allWords.length; i++) {
        const w = allWords[i].word.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!w) continue;

        const searchWindow = textTracker.substring(currentSearchPos, currentSearchPos + 100);
        const localIdx = searchWindow.indexOf(w);

        if (localIdx !== -1) {
            const globalIdx = currentSearchPos + localIdx;
            const textBetween = textTracker.substring(currentSearchPos, globalIdx);

            if (textBetween.includes('\n')) {
                if (i > 0) breaks.add(i - 1);
            }
            currentSearchPos = globalIdx + w.length;
        }
    }
    return breaks;
};

// ================= 智能断句与排版算法 =================
const buildSubtitleStructures = (allWords, rawText) => {
    const abbrs = ["u.s.", "u.k.", "mr.", "mrs.", "dr.", "ms.", "prof.", "inc.", "ltd.", "st.", "vs.", "i.e.", "e.g.", "a.m.", "p.m."];
    const isAbbr = (w) => abbrs.includes(w.toLowerCase()) || /^[a-z]\.$/i.test(w);

    const pBreaks = getParagraphBreaks(allWords, rawText);

    let sentences = [];
    let curSentenceWords = [];
    
    allWords.forEach((wObj, i) => {
        curSentenceWords.push(wObj);
        const wText = wObj.word.trim();
        const nextGap = i < allWords.length - 1 ? allWords[i+1].start - wObj.end : 0;
        
        const isStrongPunct = /[.?!。？！"”]['"]*$/.test(wText) && !isAbbr(wText);
        const isParaBreak = pBreaks.has(i) || (nextGap > 1.5 && !rawText); 
        
        if (isStrongPunct || isParaBreak || i === allWords.length - 1) {
            sentences.push({
                words: [...curSentenceWords],
                isBlockEnd: isParaBreak
            });
            curSentenceWords = [];
        }
    });

    let parsedSentences = [];
    let currentBlockIdx = 0;
    
    sentences.forEach((sentData, sIdx) => {
        let chunks = [];
        let curChunkWords = [];
        let sentWords = sentData.words;
        
        for (let i = 0; i < sentWords.length; i++) {
            curChunkWords.push(sentWords[i]);
            const wText = sentWords[i].word.trim();
            const isWeakPunct = /[,;，；]['"]*$/.test(wText);
            const remainingWords = sentWords.length - 1 - i;
            
            let forceSplit = false;
            if (i === sentWords.length - 1) {
                forceSplit = true;
            } else if (curChunkWords.length >= 20) {
                forceSplit = true;
            } else if (curChunkWords.length >= 12 && isWeakPunct && remainingWords >= 4) {
                forceSplit = true; 
            }
            
            if (forceSplit) {
                chunks.push({
                    id: `c_${sIdx}_${chunks.length}`,
                    en: curChunkWords.map(w => w.word).join(" ").replace(/\s+([.,?!;])/g, "$1"),
                    start: curChunkWords[0].start,
                    end: curChunkWords[curChunkWords.length - 1].end,
                    words: curChunkWords
                });
                curChunkWords = [];
            }
        }
        
        if (chunks.length > 0) {
            parsedSentences.push({
                id: `s_${sIdx}_${Date.now()}`,
                blockId: `block-${currentBlockIdx}`,
                en: sentWords.map(w => w.word).join(" ").replace(/\s+([.,?!;])/g, "$1"),
                zh: "",
                chunks: chunks
            });
        }
        
        if (sentData.isBlockEnd) {
            currentBlockIdx++;
        }
    });
    
    return parsedSentences;
};

const splitChineseText = (text) => {
    if (!text) return [];
    const chunks = [];
    let currentChunk = "";
    for (let i = 0; i < text.length; i++) {
        currentChunk += text[i];
        if (currentChunk.length >= 30 && /[。？！”’，；、\n]/.test(text[i])) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
        }
    }
    if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
    return chunks;
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function App() {
  const [audioBaseUrl, setAudioBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [audioKey, setAudioKey] = useState('');
  const [audioModel, setAudioModel] = useState('whisper-large-v3');
  
  const [textBaseUrl, setTextBaseUrl] = useState('https://api.groq.com/openai/v1');
  const [textKey, setTextKey] = useState('');
  const [textModel, setTextModel] = useState('llama-3.1-8b-instant');

  const [isEnSourceRaw, setIsEnSourceRaw] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('wx_audio_url_v_groq4')) setAudioBaseUrl(localStorage.getItem('wx_audio_url_v_groq4'));
    if (localStorage.getItem('wx_audio_key_v_groq4')) setAudioKey(localStorage.getItem('wx_audio_key_v_groq4'));
    if (localStorage.getItem('wx_audio_model_v_groq4')) setAudioModel(localStorage.getItem('wx_audio_model_v_groq4'));
    if (localStorage.getItem('wx_text_url_v_groq4')) setTextBaseUrl(localStorage.getItem('wx_text_url_v_groq4'));
    if (localStorage.getItem('wx_text_key_v_groq4')) setTextKey(localStorage.getItem('wx_text_key_v_groq4'));
    if (localStorage.getItem('wx_text_model_v_groq4')) setTextModel(localStorage.getItem('wx_text_model_v_groq4'));
  }, []);
  
  const [formData, setFormData] = useState({
    title: '新建音频字幕项目',
    audioFile: null, 
    audioName: '',
    audioUrl: '',
    audioDuration: 0,
    rawText: ''
  });

  const [sentences, setSentences] = useState([]);
  const [blocks, setBlocks] = useState([]); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState("");
  const [newsDate, setNewsDate] = useState('');
  
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  
  const audioRef = useRef(null);
  const exportCanvasRef = useRef(null);
  const imageElementCache = useRef({}); 

  const getFormattedDate = () => {
    const date = new Date();
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  };

  useEffect(() => {
    blocks.forEach(b => {
        if (b.image && !imageElementCache.current[b.image]) {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = b.image;
            imageElementCache.current[b.image] = img;
        }
    });
  }, [blocks]);

  const startProcessing = async () => {
    if (!formData.audioUrl) return alert("请上传音频文件！");
    if (!audioKey || !textKey) return alert("请完善 API 密钥 (语音与翻译都需要配置)！");
    
    setIsProcessing(true);
    setSentences([]);
    setBlocks([]);
    setIsPlaying(false);
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
    }
    
    try {
      setProcessMsg("1. 正在通过 Groq 全局节点进行高精度音频识别与对齐...");
      const whisperUrl = `${audioBaseUrl.trim().replace(/\/+$/, '')}/audio/transcriptions`;
      const audioData = new FormData();
      audioData.append('file', formData.audioFile);
      audioData.append('model', audioModel.trim());
      audioData.append('response_format', 'verbose_json'); 
      audioData.append('timestamp_granularities[]', 'word'); 
      
      const whisperRes = await fetch(whisperUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${audioKey}` },
        body: audioData
      }).catch(err => {
          throw new Error("网络断开或遭遇浏览器 CORS 跨域拦截，请确保已开启全局 VPN 代理。");
      });

      if (!whisperRes.ok) {
          if (whisperRes.status === 503) {
              throw new Error("503 Service Unavailable: 解析服务器目前崩溃宕机或过载，请稍后再试或更换节点。");
          }
          let errText = whisperRes.statusText;
          try { const errJson = await whisperRes.json(); errText = errJson.error?.message || errText; } catch(e) {}
          throw new Error(`Whisper 识别失败 (${whisperRes.status}): ${errText}`);
      }
      
      const whisperResult = await whisperRes.json();
      let allWords = [];
      if (whisperResult.words && whisperResult.words.length > 0) {
          allWords = whisperResult.words;
      } else if (whisperResult.segments) {
          whisperResult.segments.forEach(seg => {
              const words = seg.text.trim().split(/\s+/);
              const totalChars = words.reduce((acc, w) => acc + w.length, 0);
              const duration = seg.end - seg.start;
              let t = seg.start;
              words.forEach(w => {
                  const wDur = totalChars > 0 ? (w.length / totalChars) * duration : 0;
                  allWords.push({ word: w, start: t, end: t + wDur });
                  t += wDur;
              });
          });
      } else {
          throw new Error("接口未返回时间轴数据。");
      }
      
      setProcessMsg("2. 启动原稿严格对齐引擎划分新闻段落...");
      const parsedSentences = buildSubtitleStructures(allWords, formData.rawText);

      const uniqueBlocks = [...new Set(parsedSentences.map(s => s.blockId))];
      const initialBlocks = uniqueBlocks.map((bId, idx) => ({
          id: bId,
          title: `新闻内容段落 ${idx + 1}`,
          image: ""
      }));

      const chatUrl = `${textBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
      let extractedDateStr = "";
      const chunkSize = 8; 
      const totalChunks = Math.ceil(parsedSentences.length / chunkSize);

      for (let i = 0; i < parsedSentences.length; i += chunkSize) {
        setProcessMsg(`3. Llama 模型双语意译同步中 (第 ${Math.floor(i/chunkSize)+1}/${totalChunks} 批)...`);
        const chunk = parsedSentences.slice(i, i + chunkSize);
        const isFirstChunk = i === 0;
        
        const translationPrompt = `You are a professional subtitle translator.
        1. Contextualize using the RAW REFERENCE provided.
        ${isEnSourceRaw ? '2. CRITICAL: For the "en" field in JSON, you MUST replace the OCR English text with the EXACT matching phrases from the RAW REFERENCE. Fix any typos.' : '2. Translate the full English sentences to natural Chinese.'}
        3. Translate the full English sentences to natural Chinese. STRCITLY USE SIMPLIFIED CHINESE (简体中文).
        ${isFirstChunk ? '4. Extract broadcast date if mentioned (e.g. "Wednesday, Oct 11th") to Chinese format (e.g. "10月11日 星期三"). Else return "".' : '4. extractedDate MUST be "".'}
        5. You MUST translate EVERY SINGLE sentence provided. Return EXACTLY ${chunk.length} items mapping exactly to the input "id".

        RAW REFERENCE: ${formData.rawText ? formData.rawText.substring(0, 1500) : "None."}
        INPUT JSON: ${JSON.stringify(chunk.map(c => ({ id: c.id, en: c.en })))}

        OUTPUT MUST BE VALID JSON FORMAT:
        {
          "extractedDate": "...",
          "subtitles": [ { "id": <exact_id>, "en": "...", "zh": "..." } ]
        }`;

        let chunkSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!chunkSuccess && retryCount < maxRetries) {
          try {
            const llmRes = await fetch(chatUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${textKey}` },
              body: JSON.stringify({
                model: textModel.trim(),
                messages: [{ role: 'user', content: translationPrompt }],
                temperature: 0.1,
                response_format: { type: "json_object" } 
              })
            });

            if (!llmRes.ok) {
                let errMsg = llmRes.statusText || "未知报错";
                try {
                    const errRaw = await llmRes.text();
                    const errJson = JSON.parse(errRaw);
                    errMsg = errJson.error?.message || errJson.message || errRaw;
                } catch (e) {}
                if (llmRes.status === 429) throw new Error("429");
                throw new Error(`${llmRes.status} ${errMsg}`);
            }
            
            const llmResult = await llmRes.json();
            let content = llmResult.choices[0].message.content;
            
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error(`大模型未返回有效的 JSON 结构。原始片段: ${content.substring(0,50)}`);
            
            let parsed;
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (parseErr) {
                console.error("导致崩溃的原始 LLM 返回内容:", content);
                throw new Error(`JSON Parse error: ${parseErr.message}`);
            }

            const transDict = {};
            (parsed.subtitles || []).forEach(t => transDict[t.id] = { zh: t.zh, en: t.en });
            
            chunk.forEach(sent => {
                const result = transDict[sent.id] || {};
                sent.zh = result.zh || "（防漏译：大模型未生成此句中文，请手动补全）";
                if (isEnSourceRaw && result.en) {
                    sent.en = result.en;
                    if (sent.chunks && sent.chunks.length > 0) {
                        sent.chunks[0].en = result.en;
                        for (let k = 1; k < sent.chunks.length; k++) sent.chunks[k].en = "";
                    }
                }
            });

            if (isFirstChunk && parsed.extractedDate) extractedDateStr = parsed.extractedDate;
            chunkSuccess = true;

          } catch (e) {
            console.error("翻译异常:", e);
            let displayError = e.message;
            if (e.name === "TypeError" && e.message.includes("fetch")) {
                displayError = "VPN路由失败或跨域拦截";
            }

            if (e.message === "429") {
                retryCount++;
                setProcessMsg(`触发额度超限保护 (Groq限制)，系统智能休眠 ${retryCount * 10} 秒后自动续传...`);
                await delay(10000 * retryCount);
                continue;
            }

            if (retryCount >= maxRetries - 1) {
                chunk.forEach(sent => { sent.zh = `【异常报错】${displayError}`; });
                break;
            }
            retryCount++;
            setProcessMsg(`节点通道受阻 [${displayError}]，尝试重新唤醒 (${retryCount}/${maxRetries})...`);
            await delay(3000);
          }
        }
        if (i + chunkSize < parsedSentences.length) await delay(2000);
      }

      setNewsDate(extractedDateStr || getFormattedDate());
      setProcessMsg("4. 装载双轨媒体池与防跳动网格...");
      
      setBlocks(initialBlocks);

      setTimeout(() => {
        setSentences(parsedSentences);
        setCurrentTime(0);
        setIsProcessing(false);
      }, 500);

    } catch (error) {
      console.error("处理失败:", error);
      alert(`工作台解析遇阻！\n\n【诊断报告】:\n${error.message}`);
      setIsProcessing(false);
    }
  };

  const handleMergeSentenceUp = (sentIdx) => {
    setSentences(prev => {
        if (sentIdx <= 0) return prev;
        const newSentences = [...prev];
        const prevSent = newSentences[sentIdx - 1];
        const curSent = newSentences[sentIdx];

        if (prevSent.blockId !== curSent.blockId) return prev; 

        const mergedSent = {
            ...prevSent,
            en: prevSent.en + " " + curSent.en,
            zh: prevSent.zh + curSent.zh,
            chunks: [...prevSent.chunks, ...curSent.chunks]
        };

        newSentences.splice(sentIdx - 1, 2, mergedSent);
        return newSentences;
    });
  };

  const handleMergeChunkUp = (sentIdx, cIdx) => {
    setSentences(prev => {
        if (cIdx <= 0) return prev;
        const newSentences = [...prev];
        const sent = { ...newSentences[sentIdx] };
        const chunks = [...sent.chunks];

        const prevChunk = chunks[cIdx - 1];
        const targetChunk = chunks[cIdx];

        const mergedChunk = {
            ...prevChunk,
            en: prevChunk.en + " " + targetChunk.en,
            end: targetChunk.end
        };

        chunks.splice(cIdx - 1, 2, mergedChunk);
        sent.chunks = chunks;
        sent.en = sent.chunks.map(c => c.en).join(" "); 
        
        newSentences[sentIdx] = sent;
        return newSentences;
    });
  };

  const handleChunkKeyDown = (e, sentIdx, cIdx) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const cursorIdx = e.target.selectionStart;
        
        setSentences(prev => {
            const newSentences = [...prev];
            const sent = { ...newSentences[sentIdx] };
            const chunks = [...sent.chunks];
            const targetChunk = chunks[cIdx];
            
            if (cursorIdx === 0 || cursorIdx === targetChunk.en.length) return prev;
            
            const textA = targetChunk.en.substring(0, cursorIdx).trim();
            const textB = targetChunk.en.substring(cursorIdx).trim();
            if (!textA || !textB) return prev;
            
            const ratio = textA.length / (textA.length + textB.length);
            const duration = targetChunk.end - targetChunk.start;
            const midTime = targetChunk.start + duration * ratio;
            
            const chunkA = { ...targetChunk, id: targetChunk.id + '_a_' + Date.now(), en: textA, end: midTime };
            const chunkB = { ...targetChunk, id: targetChunk.id + '_b_' + Date.now(), en: textB, start: midTime };
            
            const sentStart = chunks[0].start;
            const sentEnd = chunks[chunks.length - 1].end;
            const sentDur = sentEnd - sentStart;
            const absoluteSplitRatio = sentDur > 0 ? (midTime - sentStart) / sentDur : 0.5;
            
            const zhLength = sent.zh.length;
            const absoluteZhSplitIdx = Math.floor(zhLength * absoluteSplitRatio);

            const zhA = sent.zh.substring(0, absoluteZhSplitIdx);
            const zhB = sent.zh.substring(absoluteZhSplitIdx);

            const sentA = {
                ...sent,
                id: sent.id + '_a_' + Date.now(),
                zh: zhA,
                chunks: [...chunks.slice(0, cIdx), chunkA],
            };
            sentA.en = sentA.chunks.map(c => c.en).join(" ");

            const sentB = {
                ...sent,
                id: sent.id + '_b_' + Date.now(),
                zh: zhB,
                chunks: [chunkB, ...chunks.slice(cIdx + 1)],
            };
            sentB.en = sentB.chunks.map(c => c.en).join(" ");

            newSentences.splice(sentIdx, 1, sentA, sentB);
            return newSentences;
        });
    } else if (e.key === 'Backspace') {
        if (e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
            e.preventDefault();
            if (cIdx > 0) {
                handleMergeChunkUp(sentIdx, cIdx);
            } else if (sentIdx > 0) {
                handleMergeSentenceUp(sentIdx);
            }
        }
    }
  };

  const handleSplitAfter = (sentenceId, currentBlockId) => {
    const newBlockId = 'block-' + Date.now();
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === currentBlockId);
        const newBlocks = [...prev];
        newBlocks.splice(idx + 1, 0, { id: newBlockId, title: `手工划分段落 ${newBlocks.length + 1}`, image: "" });
        return newBlocks;
    });
    setSentences(prev => {
        let passed = false;
        return prev.map(sent => {
            if (sent.id === sentenceId) { passed = true; return sent; }
            if (passed && sent.blockId === currentBlockId) return { ...sent, blockId: newBlockId };
            return sent;
        });
    });
  };

  const handleMergeUp = (blockId) => {
    setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === blockId);
        if (idx <= 0) return prev;
        const targetBlockId = prev[idx - 1].id;
        setSentences(subs => subs.map(sent => sent.blockId === blockId ? { ...sent, blockId: targetBlockId } : sent));
        const newBlocks = [...prev];
        newBlocks.splice(idx, 1);
        return newBlocks;
    });
  };

  const handleReplaceBlockImage = (blockId, file) => {
    if (!file) return;
    const newBlobUrl = URL.createObjectURL(file);
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, image: newBlobUrl } : b));
  };

  const handleRenameBlock = (blockId, newTitle) => {
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, title: newTitle } : b));
  };

  const togglePlay = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      const audio = audioRef.current;
      if (!formData.audioUrl) return alert("请先上传主音频！");
      if (!audio || isExportingVideo) return;
      
      if (!audio.paused) {
          audio.pause();
          setIsPlaying(false);
      } else {
          if (audio.currentTime >= (formData.audioDuration || audio.duration) - 0.1 || audio.ended) {
              audio.currentTime = 0;
              setCurrentTime(0);
          }
          const playPromise = audio.play();
          if (playPromise !== undefined) {
              playPromise.then(() => setIsPlaying(true)).catch(err => {
                  console.error("播放受阻:", err);
                  alert("由于 Safari 隐私策略，自动播放被阻拦。请在网页上点击任意元素激活权限后再试。");
                  setIsPlaying(false);
              });
          } else {
              setIsPlaying(true);
          }
      }
  };

  const handleTimeUpdate = () => { 
      if (audioRef.current && !isExportingVideo) setCurrentTime(audioRef.current.currentTime); 
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) audioRef.current.currentTime = newTime;
  };
  const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}.${Math.floor((s%1)*10)}`;

  const handleExportSRT = () => {
    let srt = "";
    let srtIdx = 1;
    sentences.forEach(sent => {
        if (!sent.chunks || sent.chunks.length === 0) return;
        const start = sent.chunks[0].start;
        const end = sent.chunks[sent.chunks.length - 1].end;
        const pad = (n, s) => ('000'+n).slice(s*-1);
        const fmt = (sec) => `${pad(Math.floor(sec/3600),2)}:${pad(Math.floor((sec%3600)/60),2)}:${pad(Math.floor(sec%60),2)},${pad(Math.floor((sec%1)*1000),3)}`;
        srt += `${srtIdx++}\n${fmt(start)} --> ${fmt(end)}\n${sent.en}\n${sent.zh}\n\n`;
    });
    const blob = new Blob([srt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${formData.title}.srt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const wrapTextCanvas = (ctx, text, x, y, maxWidth, lineHeight) => {
      if (!text) return y;
      let line = '';
      let currentY = y;
      const tokens = text.match(/[\u4e00-\u9fa5]|[\w\.\,\!\?\-\']+|\s+/g) || text.split('');
      for (let n = 0; n < tokens.length; n++) {
          const token = tokens[n];
          const testLine = line + token;
          if (ctx.measureText(testLine).width > maxWidth && n > 0 && token.trim() !== '') {
              ctx.fillText(line, x, currentY);
              line = token;
              currentY += lineHeight;
          } else {
              line = testLine;
          }
      }
      ctx.fillText(line, x, currentY);
      return currentY + lineHeight;
  };

  const drawRoundRect = (ctx, x, y, w, h, r) => {
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); } else {
          ctx.beginPath(); ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
          ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h);
          ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y); ctx.closePath();
      }
  };

  const startVideoExport = async () => {
      if (!formData.audioUrl || sentences.length === 0) return alert("请先完成剧本构建。");
      setIsPlaying(false);
      setIsExportingVideo(true);
      setExportProgress(0);

      const canvas = exportCanvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1080, 1920);

      let recordedChunks = [];
      let animationId;
      let mediaRecorder;

      try {
          if (!canvas.captureStream) throw new Error("当前 Safari 版本不支持流捕获，建议使用 Chrome 导出视频。");
          const canvasStream = canvas.captureStream(30);
          
          const audio = new Audio(formData.audioUrl);
          audio.crossOrigin = "anonymous";
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();
          const source = audioCtx.createMediaElementSource(audio);
          
          source.connect(dest);
          source.connect(audioCtx.destination); 
          
          const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
          const supportedMimeTypes = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm', ''];
          let options = {};
          for (let type of supportedMimeTypes) {
              if (type === '' || MediaRecorder.isTypeSupported(type)) {
                  if (type !== '') options.mimeType = type; break;
              }
          }

          mediaRecorder = new MediaRecorder(combinedStream, options);
          mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
          mediaRecorder.onstop = () => {
              const ext = (options.mimeType || '').includes('webm') ? 'webm' : 'mp4';
              const blob = new Blob(recordedChunks, { type: options.mimeType || 'video/mp4' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
              a.download = `KidNuz_Export.${ext}`; a.click();
              setIsExportingVideo(false); cancelAnimationFrame(animationId); audioCtx.close();
          };

          const drawFrame = () => {
              const time = audio.currentTime;
              setExportProgress(time / (formData.audioDuration || audio.duration));

              ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1080, 1920);
              
              ctx.fillStyle = '#ffffff'; ctx.font = 'bold 120px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('KidNuz', 540, 150);
              ctx.fillStyle = '#facc15'; ctx.font = '500 45px sans-serif'; ctx.fillText(newsDate || getFormattedDate(), 540, 220);

              let activeSentence = null;
              let activeChunk = null;
              for (let i = 0; i < sentences.length; i++) {
                  const sent = sentences[i];
                  if (sent.chunks.length === 0) continue;
                  if (time >= sent.chunks[0].start && time <= sent.chunks[sent.chunks.length - 1].end) {
                      activeSentence = sent;
                      activeChunk = sent.chunks.find(c => time >= c.start && time <= c.end);
                      break;
                  }
              }

              let targetImage = "";
              const referenceSentence = activeSentence || sentences.slice().reverse().find(s => s.chunks[0]?.start <= time) || sentences[0];
              if (referenceSentence) {
                  const blockIdx = blocks.findIndex(b => b.id === referenceSentence.blockId);
                  for (let i = blockIdx; i >= 0; i--) {
                      if (blocks[i] && blocks[i].image) { targetImage = blocks[i].image; break; }
                  }
              }

              const imgY = 260; const imgH = 1080 * (9/16); 
              if (targetImage && imageElementCache.current[targetImage]) {
                  ctx.drawImage(imageElementCache.current[targetImage], 0, imgY, 1080, imgH);
              } else {
                  ctx.fillStyle = '#111827'; ctx.fillRect(0, imgY, 1080, imgH);
              }

              if (activeSentence) {
                  const displayEn = activeChunk ? activeChunk.en : activeSentence.chunks[activeSentence.chunks.length - 1].en;
                  const boxWidth = 960; const boxX = 60; const textX = 100; const textMaxWidth = 880;
                  const enBoxY = imgY + imgH + 60;
                  ctx.font = '600 48px sans-serif';
                  
                  let maxEnBoxHeight = 0;
                  activeSentence.chunks.forEach(c => {
                      let simY = enBoxY + 70;
                      const tokens = c.en.match(/[\w\.\,\!\?\-\']+|\s+/g) || c.en.split('');
                      let simLine = '';
                      for (let n = 0; n < tokens.length; n++) {
                          const testLine = simLine + tokens[n];
                          if (ctx.measureText(testLine).width > textMaxWidth && n > 0 && tokens[n].trim() !== '') {
                              simLine = tokens[n]; simY += 65;
                          } else { simLine = testLine; }
                      }
                      if ((simY - enBoxY) + 50 > maxEnBoxHeight) maxEnBoxHeight = (simY - enBoxY) + 50;
                  });

                  ctx.fillStyle = 'rgba(30, 58, 138, 0.6)'; ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)'; ctx.lineWidth = 3;
                  drawRoundRect(ctx, boxX, enBoxY, boxWidth, maxEnBoxHeight, 24); ctx.fill(); ctx.stroke();
                  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
                  wrapTextCanvas(ctx, displayEn, textX, enBoxY + 70, textMaxWidth, 65);

                  const zhBoxY = enBoxY + maxEnBoxHeight + 40;
                  ctx.font = 'bold 42px sans-serif';
                  let maxZhBoxHeight = 0;
                  const zhChunksList = splitChineseText(activeSentence.zh);
                  zhChunksList.forEach(chunk => {
                      let zhSimY = zhBoxY + 65;
                      const zhTokens = chunk.split('');
                      let zhSimLine = '';
                      for (let n = 0; n < zhTokens.length; n++) {
                          const testLine = zhSimLine + zhTokens[n];
                          if (ctx.measureText(testLine).width > textMaxWidth && n > 0) {
                              zhSimLine = zhTokens[n]; zhSimY += 60;
                          } else { zhSimLine = testLine; }
                      }
                      if ((zhSimY - zhBoxY) + 45 > maxZhBoxHeight) maxZhBoxHeight = (zhSimY - zhBoxY) + 45;
                  });

                  let activeZh = activeSentence.zh;
                  if (zhChunksList.length > 0) {
                      const totalDur = activeSentence.chunks[activeSentence.chunks.length-1].end - activeSentence.chunks[0].start;
                      let elapsed = time - activeSentence.chunks[0].start;
                      const idx = Math.min(Math.floor((elapsed / totalDur) * zhChunksList.length), zhChunksList.length - 1);
                      activeZh = zhChunksList[Math.max(0, idx)];
                  }

                  ctx.fillStyle = '#4285F4'; ctx.strokeStyle = '#4285F4';
                  drawRoundRect(ctx, boxX, zhBoxY, boxWidth, maxZhBoxHeight, 24); ctx.fill(); ctx.stroke();
                  ctx.fillStyle = '#ffffff';
                  wrapTextCanvas(ctx, activeZh, textX, zhBoxY + 65, textMaxWidth, 60);
              }

              animationId = requestAnimationFrame(drawFrame);
          };

          mediaRecorder.start();
          audio.play().catch(() => alert("由于安全机制，音频导出需要您在此页面任意点击后再试。"));
          drawFrame();

      } catch (e) {
          console.error(e);
          alert(`视频导出初始化失败: ${e.message}`);
          setIsExportingVideo(false); cancelAnimationFrame(animationId);
      }
  };

  const renderPhoneScreen = () => {
    if (isProcessing) return <div className="flex-1 flex flex-col items-center justify-center bg-black text-white p-6"><Loader2 size={40} className="animate-spin text-[#4285F4] mb-4" /><p className="text-sm">{processMsg}</p></div>;
    if (sentences.length === 0) return <div className="flex-1 flex flex-col items-center justify-center bg-black text-gray-500 p-6 text-center"><ImageIcon size={48} className="opacity-50 mb-4" /><p className="text-sm">上传剧本，开启全屏工作流</p></div>;

    let activeSentence = null;
    let activeChunk = null;
    for (let i = 0; i < sentences.length; i++) {
        const sent = sentences[i];
        if (sent.chunks.length === 0) continue;
        if (currentTime >= sent.chunks[0].start && currentTime <= sent.chunks[sent.chunks.length - 1].end) {
            activeSentence = sent;
            activeChunk = sent.chunks.find(c => currentTime >= c.start && currentTime <= c.end);
            break;
        }
    }

    let targetImage = ""; 
    const referenceSentence = activeSentence || sentences.slice().reverse().find(s => s.chunks[0]?.start <= currentTime) || sentences[0];
    if (referenceSentence) {
        const blockIdx = blocks.findIndex(b => b.id === referenceSentence.blockId);
        for (let i = blockIdx; i >= 0; i--) {
            if (blocks[i] && blocks[i].image) { targetImage = blocks[i].image; break; }
        }
    }

    let longestChunkEn = "";
    if (activeSentence) {
        longestChunkEn = activeSentence.chunks.reduce((p, c) => c.en.length > p.en.length ? c : p, { en: "" }).en;
    }

    const zhChunksTextList = activeSentence ? splitChineseText(activeSentence.zh) : [];
    let activeZh = activeSentence ? activeSentence.zh : "";
    if (activeSentence && zhChunksTextList.length > 0) {
        const totalDur = activeSentence.chunks[activeSentence.chunks.length-1].end - activeSentence.chunks[0].start;
        let elapsed = currentTime - activeSentence.chunks[0].start;
        const idx = Math.min(Math.floor((elapsed / totalDur) * zhChunksTextList.length), zhChunksTextList.length - 1);
        activeZh = zhChunksTextList[Math.max(0, idx)];
    }

    return (
      <div className="relative flex flex-col h-full w-full bg-black overflow-hidden cursor-pointer" onClick={togglePlay}>
        <div className="flex-none pt-12 pb-2 flex flex-col items-center justify-center text-white px-6 text-center z-10 shrink-0">
          <h1 className="text-[28px] font-extrabold tracking-tight mb-0.5 font-sans leading-none">KidNuz</h1>
          <p className="text-[11px] font-medium opacity-95 text-yellow-400 leading-none">{newsDate || getFormattedDate()}</p>
        </div>

        <div className="w-full shrink-0 relative" style={{ aspectRatio: '16/9' }}>
           {targetImage ? <CrossfadeImage src={targetImage} /> : <div className="w-full h-full bg-gray-900 flex items-center justify-center"><ImageIcon size={32} className="text-gray-600 opacity-50" /></div>}
           {!isPlaying && <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"><div className="bg-black/50 rounded-full p-4 backdrop-blur-md shadow-xl"><Play size={32} fill="currentColor" className="text-white ml-1" /></div></div>}
        </div>
        
        <div className="flex-1 w-full px-4 pt-4 overflow-hidden flex flex-col justify-start">
            {activeSentence && (
              <>
                <div className="w-full bg-blue-900/60 backdrop-blur-md rounded-xl border border-blue-500/30 grid">
                  <div className="col-start-1 row-start-1 p-3.5 opacity-0 pointer-events-none select-none">
                    <p className="font-semibold text-[17px] leading-[1.4] text-left">{longestChunkEn}</p>
                  </div>
                  {activeSentence.chunks.map((chunk, cIdx) => {
                    const displayEn = activeChunk ? activeChunk.en : activeSentence.chunks[activeSentence.chunks.length - 1].en;
                    return (
                      <div key={chunk.id} className={`col-start-1 row-start-1 p-3.5 transition-opacity duration-200 ${displayEn === chunk.en ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                        <p className="text-white font-semibold text-[17px] leading-[1.4] text-left">{chunk.en}</p>
                      </div>
                    )
                  })}
                </div>

                <div className="w-full bg-[#4285F4] backdrop-blur-md rounded-xl shadow-lg grid mt-3">
                  {zhChunksTextList.length > 0 ? zhChunksTextList.map((zhChunk, zIdx) => (
                    <div key={zIdx} className={`col-start-1 row-start-1 p-3.5 transition-opacity duration-200 ${activeZh === zhChunk ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}>
                      <p className="text-white font-bold text-[15px] leading-relaxed text-left drop-shadow-sm">{zhChunk}</p>
                    </div>
                  )) : (
                    <div className="col-start-1 row-start-1 p-3.5 opacity-100 z-10">
                      <p className="text-white font-bold text-[15px] leading-relaxed text-left drop-shadow-sm">{activeSentence.zh}</p>
                    </div>
                  )}
                </div>
              </>
            )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800 z-50 group" onClick={e => e.stopPropagation()}>
          <div className="h-full bg-yellow-400 ease-linear pointer-events-none" style={{ width: `${(currentTime / (formData.audioDuration || 1)) * 100}%` }}></div>
          <input type="range" min="0" max={formData.audioDuration || 1} step="0.01" value={currentTime} onChange={handleSeek} className="absolute inset-0 w-full h-4 -top-1 opacity-0 cursor-pointer z-10" />
        </div>
      </div>
    );
  };

  const renderWorkspace = () => {
    if (sentences.length === 0) {
      return (
        <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
          <div className="p-8 max-w-3xl mx-auto w-full space-y-6 flex-1">
            <div className="border-b border-gray-200 pb-4">
              <h1 className="text-2xl font-bold text-gray-800">构建新闻项目</h1>
              <p className="text-sm text-gray-500 mt-2">已全面升级至 Llama-3.1-8B 高速引擎，消除双轨断连风险。</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl border shadow-sm space-y-2">
                <label className="text-xs font-bold flex items-center text-blue-600"><Mic size={14} className="mr-1" />Whisper 语音节点 (Groq)</label>
                <input type="text" value={audioBaseUrl} onChange={e => { setAudioBaseUrl(e.target.value); localStorage.setItem('wx_audio_url_v_groq4', e.target.value); }} className="w-full border rounded p-2 text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                <div className="flex space-x-2">
                  <input type="password" placeholder="API Key" value={audioKey} onChange={e => { setAudioKey(e.target.value); localStorage.setItem('wx_audio_key_v_groq4', e.target.value); }} className="w-1/2 border rounded p-2 text-xs outline-none" />
                  <input type="text" placeholder="Model" value={audioModel} onChange={e => { setAudioModel(e.target.value); localStorage.setItem('wx_audio_model_v_groq4', e.target.value); }} className="w-1/2 border rounded p-2 text-xs outline-none" />
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border shadow-sm space-y-2">
                <label className="text-xs font-bold flex items-center text-[#4285F4]"><MessageSquare size={14} className="mr-1" />LLM 翻译与对齐节点 (Groq)</label>
                <input type="text" value={textBaseUrl} onChange={e => { setTextBaseUrl(e.target.value); localStorage.setItem('wx_text_url_v_groq4', e.target.value); }} className="w-full border rounded p-2 text-xs outline-none focus:ring-1 focus:ring-blue-500" />
                <div className="flex space-x-2">
                  <input type="password" placeholder="API Key" value={textKey} onChange={e => { setTextKey(e.target.value); localStorage.setItem('wx_text_key_v_groq4', e.target.value); }} className="w-1/2 border rounded p-2 text-xs outline-none" />
                  <input type="text" placeholder="Model" value={textModel} onChange={e => { setTextModel(e.target.value); localStorage.setItem('wx_text_model_v_groq4', e.target.value); }} className="w-1/2 border rounded p-2 text-xs outline-none" />
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border shadow-sm space-y-4">
              <div>
                <label className="text-sm font-bold block mb-2">1. 挂载主播报音频</label>
                <div className="border border-dashed border-gray-300 rounded-lg bg-gray-50 hover:bg-gray-100 p-6 flex flex-col items-center relative overflow-hidden transition-colors">
                  {formData.audioName ? 
                    <div className="text-center"><FileAudio size={32} className="text-[#4285F4] mx-auto mb-2" /><p className="font-medium text-xs text-gray-700">{formData.audioName}</p></div> : 
                    <div className="text-center text-gray-500"><Upload size={32} className="mx-auto mb-2 text-gray-400" /><p className="text-xs">点击此处加载音频文件</p></div>
                  }
                  <input type="file" accept="audio/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) { setFormData(prev => ({...prev, audioFile: file, audioName: file.name, audioUrl: URL.createObjectURL(file)})); }
                  }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-end mb-2">
                    <label className="text-sm font-bold block">2. 粘贴原文字幕结构段</label>
                    <button 
                        onClick={() => setIsEnSourceRaw(!isEnSourceRaw)}
                        className={`flex items-center text-[11px] font-semibold px-2 py-1 rounded transition-colors ${isEnSourceRaw ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                    >
                        {isEnSourceRaw ? <ToggleRight size={14} className="mr-1" /> : <ToggleLeft size={14} className="mr-1" />}
                        {isEnSourceRaw ? '英文字幕强制以原文为准 (替换 AI)' : '英文字幕以 AI 语音识别为准'}
                    </button>
                </div>
                <textarea className="w-full h-24 p-3 text-xs border border-gray-300 rounded-lg resize-none outline-none focus:ring-1 focus:ring-blue-500 bg-gray-50" value={formData.rawText} onChange={e => setFormData({...formData, rawText: e.target.value})} placeholder="粘贴原文供大模型校对错别字..."></textarea>
              </div>
            </div>
            
            <button onClick={startProcessing} disabled={isProcessing} className="w-full bg-[#4285F4] text-white rounded-xl py-3.5 font-bold text-base hover:bg-blue-600 transition-all shadow flex items-center justify-center disabled:opacity-50">
              {isProcessing ? <Loader2 className="animate-spin mr-2" size={18} /> : <Play className="mr-2" size={18} />}
              {isProcessing ? "全局引擎协同运转中..." : "启动无损切片解析"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col bg-gray-50 relative overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center space-x-4 shrink-0 shadow-sm z-10">
           <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-[#4285F4] flex justify-center items-center hover:bg-blue-600 text-white shrink-0 shadow">
             {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
           </button>
           <div className="flex-1 space-y-1">
             <input type="range" min="0" max={formData.audioDuration || 1} step="0.01" value={currentTime} onChange={handleSeek} className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4285F4]" />
             <div className="flex justify-between text-[10px] text-gray-500 font-mono font-medium">
               <span>{formatTime(currentTime)}</span><span>{formData.audioDuration ? formatTime(formData.audioDuration) : '00:00.0'}</span>
             </div>
           </div>
           
           <div className="flex items-center space-x-2">
               <button onClick={handleExportSRT} className="bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-sm">
                <Download size={14} className="mr-1.5" /> SRT
              </button>
              <button onClick={startVideoExport} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center shadow-sm transition-colors">
                <Video size={14} className="mr-1.5" /> 导出视频
              </button>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
          {blocks.map((block, bIdx) => {
            const blockSentences = sentences.filter(s => s.blockId === block.id);
            if (blockSentences.length === 0) return null; 
            
            return (
              <div key={block.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col xl:flex-row">
                 <div className="w-full xl:w-[280px] bg-gray-50 border-b xl:border-b-0 xl:border-r border-gray-200 p-4 flex flex-col shrink-0">
                    <div className="flex items-center justify-between mb-3">
                       <input type="text" value={block.title} onChange={(e) => handleRenameBlock(block.id, e.target.value)} className="font-bold text-sm text-gray-800 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none w-2/3 px-1" />
                       {bIdx > 0 && <button onClick={() => handleMergeUp(block.id)} title="与上合并" className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"><ArrowUp size={14} /></button>}
                    </div>
                    <div className="w-full aspect-video bg-black rounded overflow-hidden relative shadow-inner border border-gray-200 mb-3 flex items-center justify-center group">
                       {block.image ? <img src={block.image} className="w-full h-full object-cover" alt="Block Cover" /> : <div className="text-gray-500 flex flex-col items-center"><ImageIcon size={24} className="mb-1 opacity-50" /><span className="text-[10px]">画面媒体位</span></div>}
                       <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none"><span className="text-white font-medium text-xs drop-shadow">点击重置画面</span></div>
                    </div>
                    <label className="w-full flex items-center justify-center bg-white border border-gray-300 text-gray-700 hover:text-blue-600 hover:border-blue-400 py-1.5 rounded-lg cursor-pointer text-xs font-semibold shadow-sm transition-colors">
                       <ImagePlus size={14} className="mr-1.5" /> 上传/替换场景图
                       <input type="file" accept="image/*" className="hidden" onChange={(e)=>handleReplaceBlockImage(block.id, e.target.files[0])} />
                    </label>
                 </div>
                 
                 <div className="flex-1 p-4 bg-white max-h-[450px] overflow-y-auto space-y-3 relative">
                    {blockSentences.map((sent, sIdx) => {
                       const sentIdx = sentences.findIndex(s => s.id === sent.id);
                       const isLastOverall = sentIdx === sentences.length - 1;
                       const isSentenceActive = sent.chunks.some(c => currentTime >= c.start && currentTime <= c.end);

                       return (
                          <div key={sent.id}>
                            <div className={`rounded-lg border transition-all duration-200 ${isSentenceActive ? 'border-sky-400 bg-sky-50/20 shadow-md ring-1 ring-sky-200' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                              
                              <div className={`px-3 py-2 border-b flex flex-col rounded-t-lg ${isSentenceActive ? 'bg-sky-100/40 border-sky-200' : 'bg-gray-50 border-gray-100'}`}>
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold text-[#4285F4]">中文统译轨道 (对应下方全组切片)</span>
                                    {sentIdx > 0 && sentences[sentIdx - 1].blockId === sent.blockId && (
                                        <button onClick={() => handleMergeSentenceUp(sentIdx)} className="text-[10px] text-blue-600 hover:text-white hover:bg-blue-500 flex items-center bg-blue-100 px-2 py-0.5 rounded transition-colors">
                                            <ArrowUp size={10} className="mr-1"/> 与上句缝合 (中英同步)
                                        </button>
                                    )}
                                </div>
                                <textarea value={sent.zh} onChange={(e) => { const n=[...sentences]; n[sentIdx].zh=e.target.value; setSentences(n); }} className="w-full text-xs font-medium text-gray-800 bg-transparent outline-none resize-none leading-relaxed min-h-[30px]" placeholder="等待引擎接入中文意译..." />
                              </div>

                              <div className="p-2 space-y-1.5">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[9px] font-bold text-gray-400">英文强制切分轴</div>
                                    <div className="text-[9px] text-yellow-600 font-medium px-1.5 py-0.5 bg-yellow-50 rounded border border-yellow-100">
                                        💡 极速微调：框内按 Enter 拆分整句，行首按 Backspace 向上合并
                                    </div>
                                </div>
                                {sent.chunks.map((chunk, cIdx) => {
                                    const isChunkActive = currentTime >= chunk.start && currentTime <= chunk.end;
                                    return (
                                        <div key={chunk.id} className={`flex items-start space-x-2 rounded p-1.5 border transition-all ${isChunkActive ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-100 bg-gray-50'}`}>
                                            <div className="flex flex-col space-y-1 w-12 shrink-0">
                                                <input type="number" step="0.1" value={chunk.start.toFixed(1)} onChange={(e) => { const n=[...sentences]; n[sentIdx].chunks[cIdx].start=parseFloat(e.target.value)||0; setSentences(n); }} className="w-full text-[9px] font-mono text-center bg-white border border-gray-200 rounded focus:border-blue-400 outline-none p-0.5" />
                                                <input type="number" step="0.1" value={chunk.end.toFixed(1)} onChange={(e) => { const n=[...sentences]; n[sentIdx].chunks[cIdx].end=parseFloat(e.target.value)||0; setSentences(n); }} className="w-full text-[9px] font-mono text-center bg-white border border-gray-200 rounded focus:border-blue-400 outline-none p-0.5" />
                                            </div>
                                            <textarea 
                                                value={chunk.en} 
                                                onKeyDown={(e) => handleChunkKeyDown(e, sentIdx, cIdx)}
                                                onChange={(e) => { const n=[...sentences]; n[sentIdx].chunks[cIdx].en=e.target.value; n[sentIdx].en = n[sentIdx].chunks.map(c=>c.en).join(" "); setSentences(n); }} 
                                                className="flex-1 text-[11px] font-medium text-gray-800 bg-transparent outline-none resize-none h-[30px]" 
                                            />
                                        </div>
                                    )
                                })}
                              </div>

                            </div>

                            {!isLastOverall && (
                              <div className="flex justify-center my-1 relative group py-1">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-gray-200 group-hover:border-blue-300 transition-colors"></div></div>
                                <button onClick={() => handleSplitAfter(sent.id, block.id)} className="relative bg-white border border-gray-200 text-gray-500 group-hover:text-[#4285F4] group-hover:border-blue-400 group-hover:shadow-sm text-[10px] px-2 py-0.5 rounded-full font-medium transition-all flex items-center opacity-0 group-hover:opacity-100">
                                  <Scissors size={10} className="mr-1" /> 在此向下拆出新段落 (News Block)
                                </button>
                              </div>
                            )}
                          </div>
                       )
                    })}
                 </div>
              </div>
            )
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-gray-800 font-sans overflow-hidden">
      <audio 
        ref={audioRef} 
        src={formData.audioUrl} 
        onTimeUpdate={handleTimeUpdate} 
        onLoadedMetadata={(e) => setFormData(prev => ({...prev, audioDuration: e.target.duration}))}
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none', display: 'block' }}
      />
      
      <canvas ref={exportCanvasRef} width={1080} height={1920} className="hidden pointer-events-none" />

      {isExportingVideo && (
        <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white backdrop-blur-sm">
            <Loader2 size={64} className="animate-spin text-green-500 mb-6" />
            <h2 className="text-3xl font-bold mb-3 tracking-wide">正在实时渲染并导出视频...</h2>
            <p className="text-gray-300 mb-8 font-medium">请勿关闭或切换页面标签，此过程需要与音频实际播放等长的时间</p>
            <div className="w-96 h-3 bg-gray-800 rounded-full overflow-hidden shadow-inner">
                <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${exportProgress * 100}%` }}></div>
            </div>
            <p className="mt-4 text-xl font-mono text-green-400">{Math.round(exportProgress * 100)}%</p>
        </div>
      )}

      <div className="w-[450px] h-full p-8 flex flex-col items-center justify-center shrink-0 border-r border-white/10 bg-black/40 relative">
         <div className="absolute top-6 left-8 text-white/50 text-xs font-bold tracking-widest flex items-center">
            <Eye size={14} className="mr-2" /> LIVE PREVIEW (16:9 顶吸版)
         </div>
         <div className="w-[375px] h-[812px] bg-black rounded-[3rem] border-[14px] border-gray-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden flex flex-col ring-1 ring-white/10">
            <div className="absolute top-0 inset-x-0 h-6 bg-gray-800 rounded-b-2xl w-1/2 mx-auto z-50"></div>
            {renderPhoneScreen()}
         </div>
      </div>

      <div className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
         {renderWorkspace()}
      </div>
    </div>
  );
}