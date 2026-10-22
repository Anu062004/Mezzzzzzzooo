// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {IRouter} from './Types.sol';
contract RewardsVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Campaign { address merchant; uint256 reward; uint256 minimumPurchase; uint256 startsAt; uint256 expiresAt; uint256 budget; }
    IERC20 public immutable token; IRouter public immutable router;
    mapping(bytes32=>Campaign) public campaigns;
    mapping(bytes32=>mapping(bytes32=>bool)) public claimed;
    event CampaignCreated(bytes32 indexed id,address indexed merchant,uint256 reward,uint256 expiresAt);
    event Funded(bytes32 indexed id,uint256 amount);
    event RewardPaid(bytes32 indexed id,bytes32 indexed quoteHash,address indexed customer,uint256 amount);
    event Reclaimed(bytes32 indexed id,uint256 amount);
    error InvalidCampaign(); error NotEligible();
    constructor(address token_,address router_) { require(token_!=address(0),'TOKEN'); token=IERC20(token_); router=IRouter(router_); }
    function create(bytes32 nonce,uint256 reward,uint256 minimumPurchase,uint256 startsAt,uint256 expiresAt) external returns(bytes32 id) {
        if(reward==0 || expiresAt<=startsAt || expiresAt<=block.timestamp)revert InvalidCampaign();
        id=keccak256(abi.encode(msg.sender,nonce)); if(campaigns[id].merchant!=address(0))revert InvalidCampaign();
        campaigns[id]=Campaign(msg.sender,reward,minimumPurchase,startsAt,expiresAt,0); emit CampaignCreated(id,msg.sender,reward,expiresAt);
    }
    function fund(bytes32 id,uint256 amount) external nonReentrant {
        Campaign storage c=campaigns[id]; if(c.merchant!=msg.sender || block.timestamp>=c.expiresAt || amount==0)revert InvalidCampaign();
        uint256 beforeBalance=token.balanceOf(address(this)); token.safeTransferFrom(msg.sender,address(this),amount);
        require(token.balanceOf(address(this))-beforeBalance==amount,'TOKEN_BEHAVIOR'); c.budget+=amount; emit Funded(id,amount);
    }
    function claim(bytes32 id,bytes32 quoteHash) external nonReentrant {
        Campaign storage c=campaigns[id]; (address merchant,address payer,uint256 amount,uint256 at)=router.payments(quoteHash);
        if(c.merchant==address(0) || merchant!=c.merchant || at<c.startsAt || at>=c.expiresAt || block.timestamp>=c.expiresAt || payer!=msg.sender || amount<c.minimumPurchase || c.budget<c.reward || claimed[id][quoteHash])revert NotEligible();
        claimed[id][quoteHash]=true; c.budget-=c.reward; token.safeTransfer(payer,c.reward); emit RewardPaid(id,quoteHash,payer,c.reward);
    }
    function reclaim(bytes32 id) external nonReentrant { Campaign storage c=campaigns[id]; if(c.merchant!=msg.sender || block.timestamp<c.expiresAt)revert InvalidCampaign(); uint256 amount=c.budget;c.budget=0; token.safeTransfer(msg.sender,amount); emit Reclaimed(id,amount); }
}
