// config.js — 환경설정만 모아둔 파일 (index.html에서 app.js보다 먼저 로드)




window.AppConfig = {
  // 🔐 Firebase Web App 설정 (Firebase 콘솔 → 프로젝트 설정 → 웹앱 구성에서 그대로 복사)
  FIREBASE_CONFIG: {
   apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
    authDomain: "puppi-d67a1.firebaseapp.com",
    projectId: "puppi-d67a1",
    storageBucket: "puppi-d67a1.appspot.com",
    messagingSenderId: "552900371836",
    appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
    measurementId: "G-9TZ81RW0PL"
  },

  // 🌐 체인 설정 (opBNB 메인넷)
  CHAIN: {
    chainIdHex: "0xCC", // 204
    chainName: "opBNB Mainnet",
    rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    blockExplorerUrls: ["https://opbnbscan.com/"]
  },

  // ⛓️ 온체인 컨트랙트 주소/ABI
  ONCHAIN: {
    TierRegistry: {
      address: "0x0000000000000000000000000000000000000000", // 배포 후 교체
      abi: [
        {
          "inputs":[{"internalType":"address","name":"user","type":"address"}],
          "name":"levelOf",
          "outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
          "stateMutability":"view","type":"function"
        }
      ]
    },
    TravelEscrow: {
      address: "0x0000000000000000000000000000000000000000", // 배포 후 교체
      abi: [
        {
          "anonymous":false,
          "inputs":[
            {"indexed":false,"internalType":"bytes32","name":"orderId","type":"bytes32"},
            {"indexed":false,"internalType":"address","name":"payer","type":"address"},
            {"indexed":false,"internalType":"address","name":"agent","type":"address"},
            {"indexed":false,"internalType":"address","name":"token","type":"address"},
            {"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}
          ],
          "name":"Book","type":"event"
        },
        {
          "inputs":[
            {"internalType":"bytes32","name":"orderId","type":"bytes32"},
            {"internalType":"address","name":"token","type":"address"},
            {"internalType":"uint256","name":"amount","type":"uint256"},
            {"internalType":"address","name":"agent","type":"address"}
          ],
          "name":"book","outputs":[],"stateMutability":"nonpayable","type":"function"
        }
      ]
    },
    // 결제용 토큰  PAW 주소 — 배포/확정 후 교체
    PAW: { address: "0x44deEe33ca98094c40D904BFf529659a742db97E" }
  }
};
