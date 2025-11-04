pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedWatermarkHandler is ZamaEthereumConfig {
    
    struct WatermarkData {
        string identifier;              
        euint32 encryptedPayload;      
        uint256 publicMetadata1;       
        uint256 publicMetadata2;       
        string description;            
        address creator;               
        uint256 timestamp;             
        uint32 decryptedPayload;       
        bool isVerified;               
    }
    
    mapping(string => WatermarkData) public watermarkRegistry;
    string[] public watermarkIdentifiers;
    
    event WatermarkRegistered(string indexed identifier, address indexed creator);
    event WatermarkVerified(string indexed identifier, uint32 decryptedPayload);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function registerWatermark(
        string calldata identifier,
        string calldata description,
        externalEuint32 encryptedPayload,
        bytes calldata inputProof,
        uint256 publicMetadata1,
        uint256 publicMetadata2
    ) external {
        require(bytes(watermarkRegistry[identifier].identifier).length == 0, "Identifier already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPayload, inputProof)), "Invalid encrypted payload");
        
        watermarkRegistry[identifier] = WatermarkData({
            identifier: identifier,
            encryptedPayload: FHE.fromExternal(encryptedPayload, inputProof),
            publicMetadata1: publicMetadata1,
            publicMetadata2: publicMetadata2,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedPayload: 0,
            isVerified: false
        });
        
        FHE.allowThis(watermarkRegistry[identifier].encryptedPayload);
        FHE.makePubliclyDecryptable(watermarkRegistry[identifier].encryptedPayload);
        
        watermarkIdentifiers.push(identifier);
        emit WatermarkRegistered(identifier, msg.sender);
    }
    
    function verifyWatermark(
        string calldata identifier, 
        bytes memory abiEncodedClearPayload,
        bytes memory decryptionProof
    ) external {
        require(bytes(watermarkRegistry[identifier].identifier).length > 0, "Watermark does not exist");
        require(!watermarkRegistry[identifier].isVerified, "Watermark already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(watermarkRegistry[identifier].encryptedPayload);
        
        FHE.checkSignatures(cts, abiEncodedClearPayload, decryptionProof);
        
        uint32 decodedPayload = abi.decode(abiEncodedClearPayload, (uint32));
        
        watermarkRegistry[identifier].decryptedPayload = decodedPayload;
        watermarkRegistry[identifier].isVerified = true;
        
        emit WatermarkVerified(identifier, decodedPayload);
    }
    
    function getEncryptedPayload(string calldata identifier) external view returns (euint32) {
        require(bytes(watermarkRegistry[identifier].identifier).length > 0, "Watermark does not exist");
        return watermarkRegistry[identifier].encryptedPayload;
    }
    
    function getWatermarkData(string calldata identifier) external view returns (
        string memory identifierValue,
        uint256 publicMetadata1,
        uint256 publicMetadata2,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedPayload
    ) {
        require(bytes(watermarkRegistry[identifier].identifier).length > 0, "Watermark does not exist");
        WatermarkData storage data = watermarkRegistry[identifier];
        
        return (
            data.identifier,
            data.publicMetadata1,
            data.publicMetadata2,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedPayload
        );
    }
    
    function getAllWatermarkIdentifiers() external view returns (string[] memory) {
        return watermarkIdentifiers;
    }
    
    function isOperational() public pure returns (bool) {
        return true;
    }
}

