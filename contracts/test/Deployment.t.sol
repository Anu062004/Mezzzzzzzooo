// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Deploy} from '../script/Deploy.s.sol';
import {PaymentRouter} from '../src/PaymentRouter.sol';
import {PartnershipRegistry} from '../src/PartnershipRegistry.sol';
import {OffersRedemption} from '../src/OffersRedemption.sol';
import {RewardsVault} from '../src/RewardsVault.sol';
import {MockToken} from './Protocol.t.sol';
interface DeployTestVm {
    function chainId(uint256) external;
    function etch(address,bytes calldata) external;
    function setEnv(string calldata,string calldata) external;
    function expectRevert() external;
}
contract DeploymentTest {
    DeployTestVm constant vm=DeployTestVm(address(uint160(uint256(keccak256('hevm cheat code')))));
    function testDeploymentChecksNetworkAndConnectsContracts() public {
        Deploy script=new Deploy();
        vm.chainId(31612);vm.expectRevert();script.run();
        vm.chainId(31611);
        MockToken token=new MockToken();vm.etch(script.MUSD(),address(token).code);
        vm.setEnv('DEPLOY_REWARDS','false');
        (PaymentRouter router,PartnershipRegistry registry,OffersRedemption offers,RewardsVault rewards)=script.run();
        require(router.token()==script.MUSD());require(router.subscriptionManager().code.length>0);
        require(address(registry).code.length>0&&address(offers).code.length>0);require(address(rewards)==address(0));
        vm.etch(script.MEZO(),address(token).code);vm.setEnv('DEPLOY_REWARDS','true');
        (router,,,rewards)=script.run();require(address(rewards.router())==address(router));require(address(rewards.token())==script.MEZO());
        vm.setEnv('DEPLOY_REWARDS','false');
    }
}
