// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {SignatureChecker} from '@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol';
contract OffersRedemption is EIP712 {
    struct Offer {bytes32 id;address merchant;address customer;uint256 discountAtomic;uint256 deadline;}
    bytes32 constant TYPEHASH=keccak256('Offer(bytes32 id,address merchant,address customer,uint256 discountAtomic,uint256 deadline)');
    mapping(address=>mapping(bytes32=>bool)) public redeemed;
    event OfferRedeemed(bytes32 indexed id,address indexed merchant,address indexed customer,uint256 discountAtomic);
    constructor() EIP712('MezoLoopOffers','1') {}
    function hashOffer(Offer memory offer) public view returns(bytes32){return _hashTypedDataV4(keccak256(abi.encode(TYPEHASH,offer)));}
    function redeem(Offer calldata offer,bytes calldata signature) external {
        require(offer.customer==msg.sender && offer.merchant!=address(0) && block.timestamp<offer.deadline && offer.discountAtomic>0 && !redeemed[offer.merchant][offer.id],'INELIGIBLE');
        require(SignatureChecker.isValidSignatureNow(offer.merchant,hashOffer(offer),signature),'SIGNATURE');
        redeemed[offer.merchant][offer.id]=true;emit OfferRedeemed(offer.id,offer.merchant,msg.sender,offer.discountAtomic);
    }
}
