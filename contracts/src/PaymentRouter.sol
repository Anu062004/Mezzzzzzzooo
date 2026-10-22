// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {SignatureChecker} from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {Quote} from './Types.sol';
import {SubscriptionManager} from './SubscriptionManager.sol';
contract PaymentRouter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Payment { address merchant; address payer; uint256 amount; uint256 timestamp; }
    bytes32 public constant QUOTE_TYPEHASH=keccak256('Quote(bytes32 orderId,address merchant,address token,uint256 amount,address partner,uint16 referralBps,uint16 cashbackBps,uint256 deadline)');
    address public immutable token;
    address public immutable subscriptionManager;
    mapping(address => mapping(bytes32 => bool)) public consumed;
    mapping(bytes32 => Payment) public payments;
    mapping(bytes32 => uint256) public refunded;
    event PaymentSettled(bytes32 indexed orderId, bytes32 indexed quoteHash, address indexed merchant, address payer, address partner, uint256 gross, uint256 merchantAmount, uint256 referralAmount, uint256 cashbackAmount);
    event OrderCancelled(address indexed merchant, bytes32 indexed orderId);
    event Refunded(bytes32 indexed quoteHash, address indexed customer, uint256 amount);
    error InvalidQuote(); error Unauthorized(); error AlreadyUsed(); error UnsupportedToken();
    constructor(address token_) EIP712('MezoLoop','1') {
        require(token_.code.length>0,'TOKEN'); token=token_; subscriptionManager=address(new SubscriptionManager(address(this)));
    }
    function hashQuote(Quote memory q) public view returns(bytes32) { return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH,q))); }
    function pay(Quote calldata q,bytes calldata signature) external nonReentrant returns(bytes32) {
        if (!SignatureChecker.isValidSignatureNow(q.merchant,hashQuote(q),signature)) revert Unauthorized();
        return _settle(q,msg.sender);
    }
    function settleRecurring(Quote calldata q,address payer) external nonReentrant returns(bytes32) {
        if(msg.sender!=subscriptionManager) revert Unauthorized(); return _settle(q,payer);
    }
    function cancel(bytes32 orderId) external { consumed[msg.sender][orderId]=true; emit OrderCancelled(msg.sender,orderId); }
    function _settle(Quote memory q,address payer) internal returns(bytes32 hash) {
        if(q.merchant==address(0) || q.merchant==address(this) || q.partner==address(this) || q.token!=token || q.amount==0 || block.timestamp>=q.deadline || uint256(q.referralBps)+q.cashbackBps>10000 || ((q.referralBps==0)!=(q.partner==address(0)))) revert InvalidQuote();
        if(consumed[q.merchant][q.orderId]) revert AlreadyUsed(); consumed[q.merchant][q.orderId]=true;
        hash=hashQuote(q); payments[hash]=Payment(q.merchant,payer,q.amount,block.timestamp);
        uint256 referral=Math.mulDiv(q.amount,q.referralBps,10000); uint256 cashback=Math.mulDiv(q.amount,q.cashbackBps,10000); uint256 seller=q.amount-referral-cashback;
        uint256 beforeBalance=IERC20(token).balanceOf(address(this)); IERC20(token).safeTransferFrom(payer,address(this),q.amount);
        if(IERC20(token).balanceOf(address(this))-beforeBalance!=q.amount) revert UnsupportedToken();
        _send(q.merchant,seller); _send(q.partner,referral); _send(payer,cashback);
        if(IERC20(token).balanceOf(address(this))!=beforeBalance) revert UnsupportedToken();
        emit PaymentSettled(q.orderId,hash,q.merchant,payer,q.partner,q.amount,seller,referral,cashback);
    }
    function _send(address to,uint256 amount) internal { if(amount==0)return; uint256 beforeBalance=IERC20(token).balanceOf(to); IERC20(token).safeTransfer(to,amount); if(IERC20(token).balanceOf(to)-beforeBalance!=amount)revert UnsupportedToken(); }
    function refund(bytes32 hash,uint256 amount) external nonReentrant {
        Payment memory p=payments[hash]; if(msg.sender!=p.merchant || amount==0 || amount>p.amount-refunded[hash])revert Unauthorized();
        refunded[hash]+=amount; IERC20(token).safeTransferFrom(msg.sender,p.payer,amount); emit Refunded(hash,p.payer,amount);
    }
}
