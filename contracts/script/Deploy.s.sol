// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20Metadata} from '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';
import {PaymentRouter} from '../src/PaymentRouter.sol';
import {PartnershipRegistry} from '../src/PartnershipRegistry.sol';
import {OffersRedemption} from '../src/OffersRedemption.sol';
import {RewardsVault} from '../src/RewardsVault.sol';
interface DeploymentVm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envOr(string calldata, bool) external returns(bool);
}
contract Deploy {
    DeploymentVm constant vm = DeploymentVm(address(uint160(uint256(keccak256('hevm cheat code')))));
    address public constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address public constant MEZO = 0x7B7c000000000000000000000000000000000001;
    event Deployment(address router,address subscriptionManager,address registry,address offers,address rewardsVault);
    function run() external returns(PaymentRouter router,PartnershipRegistry registry,OffersRedemption offers,RewardsVault rewards) {
        require(block.chainid == 31611, 'MEZO_TESTNET_ONLY');
        require(IERC20Metadata(MUSD).decimals() == 18, 'MUSD_DECIMALS');
        bool withRewards = vm.envOr('DEPLOY_REWARDS', false);
        if(withRewards) require(IERC20Metadata(MEZO).decimals() == 18, 'MEZO_DECIMALS');
        vm.startBroadcast();
        router = new PaymentRouter(MUSD);
        registry = new PartnershipRegistry();
        offers = new OffersRedemption();
        if(withRewards) rewards = new RewardsVault(MEZO,address(router));
        vm.stopBroadcast();
        emit Deployment(address(router),router.subscriptionManager(),address(registry),address(offers),address(rewards));
    }
}
