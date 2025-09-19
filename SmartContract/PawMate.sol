// SPDX-License-Identifier: MIT
pragma solidity >=0.8.17;

/// @notice Minimal ERC20-like interface for PAW token
interface Ipaw {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/// @notice External bank interface
interface IpupBank {
    function depoup(address user, uint256 depo) external;
    function depodown(address user, uint256 depo) external;
    function getprice() external view returns (uint256);
    function getlevel(address user) external view returns (uint256);
    function g9(address user) external view returns (uint256);
    function getagent(address user) external view returns (address);
    function getmento(address user) external view returns (address);
    function expup(address user, uint256 exp) external;
}

/**
 * @title PawMate
 * @notice Mate(가이드)가 바우처를 발행하고, 구매자는 PAW로 결제하여
 *         현장 승인 시 paw 보상과 함께 정산되는 간단한 escrow 흐름
 */
contract PawMate {
    // ----------------- External deps -----------------
    Ipaw public paw;
    IpupBank public pupbank;

    // ----------------- Roles & Admin -----------------
    address public admin;

    /// 스태프 권한 레벨(>=5면 스태프)
    mapping(address => uint8) public staff;

    /// mate 승인 여부
    mapping(address => bool) public mate;

    // ----------------- Voucher -----------------
    struct Voucher {
        uint256 bid;        // 바우처 id
        uint256 price;      // 바우처 가격(PAW smallest unit)
        address owner;      // 발행자(소유자)
        uint256 createdAt;  // 생성 시각
    }

    /// @notice 바우처 id => 바우처
    mapping(uint256 => Voucher) public vouchers;

    /// 내가 구매한 바우쳐
    mapping(address => uint[])public myv;
    mapping(address => mapping (uint256 => bool)) public mybuy;
      
      /// 내가 발행한 바우처 리스트
    mapping(address => uint256[]) public mypub;

        /// 바우쳐 id별 구매자 리스트
    mapping(uint => address[]) public mybuyer;

    /// @notice 최신 바우처 id (auto-increment)
    uint256 public bid;

    // ----------------- Escrow / Payout -----------------
    /// 누적 인출 금액 (지급 집계용)
    uint256 public totalw;

    /// @notice 이체 은행(지급 수령처로 사용할 수 있는 주소)
    address public pbank;

    mapping(address => uint256) public mypay;  //나의수당
    mapping(address => uint256) public mysales; // 메이트 매출
    mapping(address => uint256) public fa;


    // ----------------- Modifiers -----------------
    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    modifier onlyStaff() {
        require(msg.sender == admin || staff[msg.sender] >= 5, "not staff");
        _;
    }


    modifier onlyVoucherOwner(uint256 _bid) {
        require(vouchers[_bid].owner == msg.sender, "not voucher owner");
        _;
    }

    // ----------------- Constructor -----------------
    constructor(address _paw, address _pupbank) {
        paw = Ipaw(_paw);
        pupbank = IpupBank(_pupbank);
        pbank = _pupbank;
        admin = msg.sender;
        staff[msg.sender] = 10;
    }

    // ----------------- Admin ops -----------------
    function transferOwnership(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "zero addr");
        admin = newAdmin;
    }

    function setStaff(address account, uint8 level) external onlyAdmin {
        staff[account] = level;
    }

    function setPbank(address _pbank) external onlyAdmin {
        pbank = _pbank;
    }

  

    function faup(address _fa) external onlyStaff {
        fa[_fa] = 5;
    }

    function priceup(uint256 _bid, uint256 _price) public{
        Voucher storage v = vouchers[_bid];
        require(v.owner == msg.sender, "no owner");
        require(_price > 0, "price=0");
        v.price = _price;
    }

    /// @notice 비상시 토큰 회수(컨트랙트 보유분)
    function emergencyWithdraw() external onlyAdmin  {
        uint amount = g1();
        paw.transfer(pbank, amount);
        totalw += amount;
    }

    // ----------------- Mate ops -----------------

    /// @notice 메이트 승인(레벨 1 이상 필수) → 바우처 생성 권한 획득
    function mateok(address user) public onlyStaff {
        require(user != address(0), "zero user");
        require(pupbank.getlevel(user) >= 1, "level < 1");
        mate[user] = true;
    
    }

    /// @notice 메이트 권한 해제
    function mateno(address user) public onlyStaff {
        require(user != address(0), "zero user");
        mate[user] = false;

    }

  

    /// @notice 바우처 생성 (메이트 전용)
function bcrate(uint256 price) public returns (uint256 id) {
    require(mate[msg.sender] == true, "not a mate");
    require(price > 0, "price=0");

    id = bid;
    vouchers[id] = Voucher({
        bid: id,
        price: price,
        owner: msg.sender,
        createdAt: block.timestamp
    });
   
    mypub[msg.sender].push(id);  // 내가 발행한 바우처 리스트
    bid = id + 1;

}


    /// @notice 바우처 구매(escrow 입금) — 구매자 레벨 1 이상
    function buy(uint256 _bid) public {
        Voucher storage v = vouchers[_bid];
        require(v.price > 0, "invalid price");
        require( mybuy[msg.sender][_bid] == false, "I already bought it");  //1인당 1개만 구입가능
        // 구매자 레벨 체크
        require(pupbank.getlevel(msg.sender) >= 1, "level < 1");
        require(paw.balanceOf(msg.sender) >= v.price, "balance < price");
        // 토큰 전송 (유저 -> 본 컨트랙트)
        uint256 price = v.price;
        paw.approve(msg.sender, price);
        uint256 allowance = paw.allowance(msg.sender, address(this));
        require(allowance >= price, "Check the token allowance");
        paw.transferFrom(msg.sender, address(this), price);
       //판매자의 구매자 리스트 기록
        mybuyer[_bid].push(msg.sender);
        //구매자의 구매 리스트에 기록
        mybuy[msg.sender][_bid] = true;
        myv[msg.sender].push(_bid);
    }

  

    /// 구매자가 함수 실행(현장 확인)
    function approveVoucher(uint256 _bid) public  {
        Voucher storage v = vouchers[_bid];
        require(mybuy[msg.sender][_bid] == true, "not purchased");

        // 배분: 80% owner, 10% mentor 적립(mypay), 10% pbank/owner
        uint256 ownerShare = (v.price * 80) / 100;
        // 80% 즉시 지급 + 매출 집계
        require(paw.transfer(v.owner, ownerShare), "owner payout fail");
       
        // 10% 멘토 적립(지급은 withdraw에서)
        address mymento = pupbank.getmento(v.owner);
        if (mymento != address(0)) {
            mypay[mymento] += v.price * 10/ 100;
        }
      mysales[v.owner]  += v.price *80/100 ; // 메이트 매출
     mybuy[msg.sender][_bid] = false;
    }

    function withdraw() public {
        uint256 pay = mypay[msg.sender];
        require(pay > 0, "no pay");
        require(g1() >= pay, "no paw");
        address mymento = pupbank.getmento(msg.sender);
        require(paw.transfer(msg.sender, pay), "withdraw transfer fail");
        mypay[msg.sender] = 0;
        if (mymento != address(0)) {
            mypay[mymento] += (pay * 50) / 100;
        }
    }

    function payup(address user, uint256 _pay) public {
        require(fa[msg.sender] >= 5, "no family");
        mypay[user] += _pay;
    }

    // ----------------- Views / Helpers -----------------

    /// @notice 외부 pupbank 레벨 조회(편의)
    function getlevel(address user) external view returns (uint256) {
        return pupbank.getlevel(user);
    }

    /// @notice 컨트랙트가 보유한 PAW 잔액
    function g1() public view returns (uint256) {
        return paw.balanceOf(address(this));
    }

    /// @notice 임의 유저의 PAW 잔액
    function g2(address user) public view returns (uint256) {
        return paw.balanceOf(user);
    }


}
