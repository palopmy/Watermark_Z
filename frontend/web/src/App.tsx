import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface WatermarkData {
  id: string;
  name: string;
  creator: string;
  timestamp: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  isVerified: boolean;
  decryptedValue: number;
  encryptedValueHandle?: string;
}

interface WatermarkStats {
  totalWatermarks: number;
  verifiedWatermarks: number;
  averageStrength: number;
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [watermarks, setWatermarks] = useState<WatermarkData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingWatermark, setCreatingWatermark] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newWatermarkData, setNewWatermarkData] = useState({ 
    name: "", 
    watermarkValue: "", 
    strength: "5",
    description: "" 
  });
  const [selectedWatermark, setSelectedWatermark] = useState<WatermarkData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState<WatermarkStats>({
    totalWatermarks: 0,
    verifiedWatermarks: 0,
    averageStrength: 0,
    recentActivity: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for digital watermarking...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadWatermarks();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    calculateStats();
  }, [watermarks]);

  const calculateStats = () => {
    const total = watermarks.length;
    const verified = watermarks.filter(w => w.isVerified).length;
    const avgStrength = watermarks.length > 0 
      ? watermarks.reduce((sum, w) => sum + w.publicValue1, 0) / watermarks.length 
      : 0;
    const recent = watermarks.filter(w => 
      Date.now()/1000 - w.timestamp < 60 * 60 * 24 * 7
    ).length;

    setStats({
      totalWatermarks: total,
      verifiedWatermarks: verified,
      averageStrength: avgStrength,
      recentActivity: recent
    });
  };

  const loadWatermarks = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const watermarksList: WatermarkData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          watermarksList.push({
            id: businessId,
            name: businessData.name,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading watermark data:', e);
        }
      }
      
      setWatermarks(watermarksList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load watermarks" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createWatermark = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingWatermark(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted watermark with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const watermarkValue = parseInt(newWatermarkData.watermarkValue) || 0;
      const businessId = `watermark-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, watermarkValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newWatermarkData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newWatermarkData.strength) || 5,
        0,
        newWatermarkData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Digital watermark created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadWatermarks();
      setShowCreateModal(false);
      setNewWatermarkData({ name: "", watermarkValue: "", strength: "5", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingWatermark(false); 
    }
  };

  const verifyWatermark = async (watermarkId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const watermarkData = await contractRead.getBusinessData(watermarkId);
      if (watermarkData.isVerified) {
        const storedValue = Number(watermarkData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Watermark already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(watermarkId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(watermarkId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying watermark decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadWatermarks();
      
      setTransactionStatus({ visible: true, status: "success", message: "Watermark verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Watermark is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadWatermarks();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Verification failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE system available check successful!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-panel">
          <div className="stat-icon">🔏</div>
          <div className="stat-content">
            <h3>Total Watermarks</h3>
            <div className="stat-value">{stats.totalWatermarks}</div>
            <div className="stat-trend">+{stats.recentActivity} this week</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Verified</h3>
            <div className="stat-value">{stats.verifiedWatermarks}/{stats.totalWatermarks}</div>
            <div className="stat-trend">FHE Verified</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">🛡️</div>
          <div className="stat-content">
            <h3>Avg Strength</h3>
            <div className="stat-value">{stats.averageStrength.toFixed(1)}/10</div>
            <div className="stat-trend">Encryption Level</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqItems = [
      {
        question: "什么是FHE数字水印？",
        answer: "FHE数字水印使用全同态加密技术，在加密状态下嵌入和验证水印，无需解密原始内容即可证明版权归属。"
      },
      {
        question: "如何保证水印的安全性？",
        answer: "水印信息全程加密处理，即使验证过程也在加密状态下进行，确保原始内容永不暴露。"
      },
      {
        question: "支持哪些类型的水印？",
        answer: "目前支持整数类型的水印值，适用于数字版权标识、序列号验证等场景。"
      },
      {
        question: "验证过程需要付费吗？",
        answer: "水印创建和验证需要支付Gas费，但FHE计算本身是免费的。"
      }
    ];

    return (
      <div className="faq-section">
        <h3>常见问题解答</h3>
        <div className="faq-list">
          {faqItems.map((item, index) => (
            <div key={index} className="faq-item">
              <div className="faq-question">
                <span className="faq-icon">❓</span>
                {item.question}
              </div>
              <div className="faq-answer">{item.answer}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>水印加密</h4>
            <p>使用Zama FHE加密水印信息，生成加密水印数据</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>链上存储</h4>
            <p>加密水印数据安全存储在区块链上，标记为可公开解密</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>同态验证</h4>
            <p>在加密状态下验证水印存在性，不暴露原始内容</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>链上确认</h4>
            <p>通过FHE.checkSignatures完成最终验证确认</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔏</div>
            <h1>水印_Z - 加密数字水印</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="prompt-icon">🔐</div>
            <h2>连接钱包开始使用加密水印系统</h2>
            <p>连接您的钱包以初始化FHE加密系统，开始创建和验证数字水印</p>
            <div className="feature-steps">
              <div className="feature-step">
                <span className="step-icon">1</span>
                <p>连接钱包启用FHE加密功能</p>
              </div>
              <div className="feature-step">
                <span className="step-icon">2</span>
                <p>创建加密数字水印保护版权</p>
              </div>
              <div className="feature-step">
                <span className="step-icon">3</span>
                <p>同态验证水印不暴露原内容</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="encryption-spinner"></div>
        <p>初始化FHE加密水印系统...</p>
        <p>状态: {fhevmInitializing ? "初始化FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="encryption-spinner"></div>
      <p>加载加密水印数据...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">🔏</div>
          <div>
            <h1>水印_Z</h1>
            <span className="logo-subtitle">FHE加密数字水印</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={callIsAvailable}
            className="system-check-btn"
          >
            系统检查
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-watermark-btn"
          >
            + 创建水印
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <main className="main-content">
        <section className="stats-section">
          <h2>数字水印统计</h2>
          {renderStatsPanel()}
          
          <div className="process-panel metal-panel">
            <h3>FHE加密水印流程</h3>
            {renderFHEProcess()}
          </div>
        </section>
        
        <section className="watermarks-section">
          <div className="section-header">
            <h2>数字水印列表</h2>
            <div className="section-actions">
              <button 
                onClick={() => setShowFAQ(!showFAQ)}
                className="faq-btn"
              >
                {showFAQ ? "隐藏帮助" : "常见问题"}
              </button>
              <button 
                onClick={loadWatermarks} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "刷新中..." : "刷新列表"}
              </button>
            </div>
          </div>
          
          {showFAQ && renderFAQ()}
          
          <div className="watermarks-list">
            {watermarks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔏</div>
                <p>暂无数字水印</p>
                <button 
                  className="create-watermark-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  创建第一个水印
                </button>
              </div>
            ) : watermarks.map((watermark, index) => (
              <div 
                className={`watermark-item ${selectedWatermark?.id === watermark.id ? "selected" : ""} ${watermark.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedWatermark(watermark)}
              >
                <div className="watermark-header">
                  <div className="watermark-name">{watermark.name}</div>
                  <div className={`verification-status ${watermark.isVerified ? "verified" : "pending"}`}>
                    {watermark.isVerified ? "✅ 已验证" : "🔓 待验证"}
                  </div>
                </div>
                <div className="watermark-meta">
                  <span>强度: {watermark.publicValue1}/10</span>
                  <span>创建: {new Date(watermark.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="watermark-description">{watermark.description}</div>
                <div className="watermark-creator">创建者: {watermark.creator.substring(0, 6)}...{watermark.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
      
      {showCreateModal && (
        <CreateWatermarkModal 
          onSubmit={createWatermark} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingWatermark} 
          watermarkData={newWatermarkData} 
          setWatermarkData={setNewWatermarkData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedWatermark && (
        <WatermarkDetailModal 
          watermark={selectedWatermark} 
          onClose={() => { 
            setSelectedWatermark(null); 
            setDecryptedValue(null); 
          }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          verifyWatermark={() => verifyWatermark(selectedWatermark.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateWatermarkModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  watermarkData: any;
  setWatermarkData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, watermarkData, setWatermarkData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'watermarkValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setWatermarkData({ ...watermarkData, [name]: intValue });
    } else {
      setWatermarkData({ ...watermarkData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>创建数字水印</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE全同态加密</strong>
              <p>水印值将使用Zama FHE进行加密处理（仅支持整数）</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>水印名称 *</label>
            <input 
              type="text" 
              name="name" 
              value={watermarkData.name} 
              onChange={handleChange} 
              placeholder="输入水印名称..." 
            />
          </div>
          
          <div className="form-group">
            <label>水印值（整数） *</label>
            <input 
              type="number" 
              name="watermarkValue" 
              value={watermarkData.watermarkValue} 
              onChange={handleChange} 
              placeholder="输入水印数值..." 
              step="1"
              min="0"
            />
            <div className="input-hint">FHE加密整数</div>
          </div>
          
          <div className="form-group">
            <label>加密强度 (1-10) *</label>
            <input 
              type="range" 
              min="1" 
              max="10" 
              name="strength" 
              value={watermarkData.strength} 
              onChange={handleChange} 
            />
            <div className="strength-value">{watermarkData.strength}/10</div>
          </div>
          
          <div className="form-group">
            <label>描述信息</label>
            <textarea 
              name="description" 
              value={watermarkData.description} 
              onChange={handleChange} 
              placeholder="输入水印描述..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !watermarkData.name || !watermarkData.watermarkValue} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "加密中..." : "创建水印"}
          </button>
        </div>
      </div>
    </div>
  );
};

const WatermarkDetailModal: React.FC<{
  watermark: WatermarkData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  verifyWatermark: () => Promise<number | null>;
}> = ({ watermark, onClose, decryptedValue, setDecryptedValue, isDecrypting, verifyWatermark }) => {
  const handleVerify = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }
    
    const verifiedValue = await verifyWatermark();
    if (verifiedValue !== null) {
      setDecryptedValue(verifiedValue);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>水印详情</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="watermark-info">
            <div className="info-row">
              <span>水印名称:</span>
              <strong>{watermark.name}</strong>
            </div>
            <div className="info-row">
              <span>创建者:</span>
              <strong>{watermark.creator.substring(0, 6)}...{watermark.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>创建时间:</span>
              <strong>{new Date(watermark.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>加密强度:</span>
              <strong>{watermark.publicValue1}/10</strong>
            </div>
            <div className="info-row">
              <span>描述:</span>
              <span>{watermark.description}</span>
            </div>
          </div>
          
          <div className="verification-section">
            <h3>水印验证</h3>
            
            <div className="verification-status">
              <div className="status-label">水印值:</div>
              <div className="status-value">
                {watermark.isVerified ? 
                  `${watermark.decryptedValue} (链上已验证)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (本地解密)` : 
                  "🔒 FHE加密状态"
                }
              </div>
              <button 
                className={`verify-btn ${(watermark.isVerified || decryptedValue !== null) ? 'verified' : ''}`}
                onClick={handleVerify} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 验证中..."
                ) : watermark.isVerified ? (
                  "✅ 已验证"
                ) : decryptedValue !== null ? (
                  "🔄 重新验证"
                ) : (
                  "🔓 验证水印"
                )}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="explanation-icon">🔐</div>
              <div>
                <strong>FHE同态验证原理</strong>
                <p>水印数据在链上保持加密状态，验证过程通过零知识证明技术确认水印存在性，无需暴露原始内容。</p>
              </div>
            </div>
          </div>
          
          {(watermark.isVerified || decryptedValue !== null) && (
            <div className="result-section">
              <h3>验证结果</h3>
              <div className="verification-result">
                <div className="result-item">
                  <span>水印数值:</span>
                  <strong>
                    {watermark.isVerified ? 
                      `${watermark.decryptedValue}` : 
                      `${decryptedValue}`
                    }
                  </strong>
                  <span className={`result-badge ${watermark.isVerified ? 'chain-verified' : 'local-decrypted'}`}>
                    {watermark.isVerified ? '链上验证' : '本地解密'}
                  </span>
                </div>
                <div className="result-item">
                  <span>验证状态:</span>
                  <strong>{watermark.isVerified ? "完全验证" : "临时解密"}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">关闭</button>
          {!watermark.isVerified && (
            <button 
              onClick={handleVerify} 
              disabled={isDecrypting}
              className="chain-verify-btn"
            >
              {isDecrypting ? "链上验证中..." : "链上验证"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

