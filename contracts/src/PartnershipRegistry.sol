// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
contract PartnershipRegistry {
    struct Agreement { address merchant; address partner; uint16 bps; uint256 expiresAt; bool active; }
    mapping(bytes32=>Agreement) public agreements;
    event PartnershipApproved(bytes32 indexed id,address indexed merchant,address indexed partner,uint16 bps,uint256 expiresAt);
    event PartnershipRevoked(bytes32 indexed id);
    function approve(bytes32 nonce,address partner,uint16 bps,uint256 expiresAt) external returns(bytes32 id) {
        require(partner!=address(0) && bps<=10000 && expiresAt>block.timestamp,'TERMS');
        id=keccak256(abi.encode(msg.sender,nonce)); require(agreements[id].merchant==address(0),'EXISTS');
        agreements[id]=Agreement(msg.sender,partner,bps,expiresAt,true); emit PartnershipApproved(id,msg.sender,partner,bps,expiresAt);
    }
    function revoke(bytes32 id) external {require(agreements[id].merchant==msg.sender,'OWNER');agreements[id].active=false;emit PartnershipRevoked(id);}
}
