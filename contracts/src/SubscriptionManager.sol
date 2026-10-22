// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {SignatureChecker} from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Quote, IRouter} from './Types.sol';
contract SubscriptionManager is EIP712, ReentrancyGuard {
    struct Plan { address merchant; address partner; uint256 amount; uint16 referralBps; uint16 cashbackBps; uint256 interval; uint256 startsAt; uint256 expiresAt; uint256 maxCharges; bytes32 nonce; }
    struct Subscription { address customer; Plan plan; uint256 charges; uint256 nextDue; bool cancelled; }
    bytes32 public constant PLAN_TYPEHASH = keccak256('Plan(address merchant,address partner,uint256 amount,uint16 referralBps,uint16 cashbackBps,uint256 interval,uint256 startsAt,uint256 expiresAt,uint256 maxCharges,bytes32 nonce)');
    address public immutable router;
    mapping(bytes32 => Subscription) private subscriptions;
    event SubscriptionCreated(bytes32 indexed id, address indexed customer, address indexed merchant, bytes32 planHash);
    event SubscriptionCharged(bytes32 indexed id, uint256 period, bytes32 quoteHash, uint256 nextDue);
    event SubscriptionCancelled(bytes32 indexed id);
    error InvalidPlan(); error NotDue(); error Unauthorized();
    constructor(address router_) EIP712('MezoLoopSubscriptions','1') { router = router_; }
    function hashPlan(Plan memory p) public view returns (bytes32) { return _hashTypedDataV4(keccak256(abi.encode(PLAN_TYPEHASH,p))); }
    function subscribe(Plan calldata p, bytes calldata signature) external returns (bytes32 id) {
        if (p.merchant == address(0) || p.amount == 0 || p.interval < 60 || p.expiresAt <= block.timestamp || p.expiresAt <= p.startsAt || p.maxCharges == 0 || p.maxCharges > type(uint256).max / p.amount || uint256(p.referralBps)+p.cashbackBps>10000 || ((p.referralBps==0)!=(p.partner==address(0)))) revert InvalidPlan();
        if (!SignatureChecker.isValidSignatureNow(p.merchant,hashPlan(p),signature)) revert Unauthorized();
        id = keccak256(abi.encode(msg.sender,p.nonce));
        if (subscriptions[id].customer != address(0)) revert InvalidPlan();
        subscriptions[id] = Subscription(msg.sender,p,0,p.startsAt,false);
        emit SubscriptionCreated(id,msg.sender,p.merchant,hashPlan(p));
    }
    function getSubscription(bytes32 id) external view returns (Subscription memory) { return subscriptions[id]; }
    function cancel(bytes32 id) external { Subscription storage s=subscriptions[id]; if (s.customer!=msg.sender) revert Unauthorized(); s.cancelled=true; emit SubscriptionCancelled(id); }
    function charge(bytes32 id) external nonReentrant returns (bytes32 hash) {
        Subscription storage s=subscriptions[id]; Plan memory p=s.plan;
        if (s.customer==address(0) || s.cancelled || block.timestamp<s.nextDue || block.timestamp>=p.expiresAt || s.charges>=p.maxCharges) revert NotDue();
        uint256 period=s.charges++;
        // No back-billing bursts: the next charge is at least one full interval from now.
        s.nextDue=block.timestamp+p.interval;
        Quote memory q=Quote(keccak256(abi.encode(id,period)),p.merchant,IRouter(router).token(),p.amount,p.partner,p.referralBps,p.cashbackBps,p.expiresAt);
        hash=IRouter(router).settleRecurring(q,s.customer);
        emit SubscriptionCharged(id,period,hash,s.nextDue);
    }
}
